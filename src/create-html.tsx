import { format } from "date-fns";
import fs from "fs-extra";
import path from "path";
import React from "react";
import ReactDOMServer from "react-dom/server.js";
import ora, { Ora } from "ora";
import { chunk, sortBy } from "lodash-es";
import { dirname } from "path";
import { fileURLToPath } from "url";
import esMain from "es-main";
import slackMarkdown from "slack-markdown";

import { getChannels, getMessages, getUsers } from "./data-load.js";
import {
  ArchiveMessage,
  Channel,
  Message,
  SlackArchiveData,
  User,
  Users,
} from "./interfaces.js";
import {
  getHTMLFilePath,
  INDEX_PATH,
  OUT_DIR,
  MESSAGES_JS_PATH,
} from "./config.js";
import { slackTimestampToJavaScriptTimestamp } from "./timestamp.js";
import { recordPage } from "./search.js";
import { write } from "./data-write.js";
import { getSlackArchiveData } from "./archive-data.js";

const _dirname = dirname(fileURLToPath(import.meta.url));
const MESSAGE_CHUNK = 1000;

// This used to be a prop on the components, but passing it around
// was surprisingly slow. Global variables are cool again!
// Set by createHtmlForChannels().
let users: Users = {};
let slackArchiveData: SlackArchiveData = { channels: {} };
let me: User | null;

// Little hack to switch between ./index.html and ./html/...
let base = "";

function slackHTML(text) {
  return {
    __html: slackMarkdown.toHTML(text, {
      escapeHTML: false,
      slackCallbacks: {
        user: ({ id }: { id: string }) => `@${users[id]?.name || id}`,
        channel: ({ id, name }: { id: string, name: string }) => `<a href="${id}-0.html">#${name}</a>`,
      },
    }).replace(/<([^>]+…)$/, '&lt;$1'), // fix awkwardly truncated text
  };
}

interface TimestampProps {
  ts: string;
  format: string;
}
const Timestamp: React.FunctionComponent<TimestampProps> = (props) => {
  const jsTs = slackTimestampToJavaScriptTimestamp(props.ts);
  const ts = format(jsTs, "PPPPpppp");
  const prettyTs = format(jsTs, props.format || "PPp");

  return <span className="c-timestamp__label" title={ts}>{prettyTs}</span>;
};

interface FilesProps {
  message: Message;
  channelId: string;
}
const Files: React.FunctionComponent<FilesProps> = (props) => {
  const { message, channelId } = props;
  const { files } = message;

  if (!files || files.length === 0) return null;

  const fileElements = files.map((file) => {
    const { thumb_1024, thumb_720, thumb_480, thumb_pdf } = file as any;
    const thumb = thumb_1024 || thumb_720 || thumb_480 || thumb_pdf;
    let src = `files/${channelId}/${file.id}.${file.filetype}`;
    let href = src;

    if (file.mimetype?.startsWith("image")) {
      return (
        <a key={file.id} href={href} target="_blank">
          <img className="file" src={src} />
        </a>
      );
    }

    if (file.mimetype?.startsWith("video")) {
      return <video key={file.id} controls src={src} />;
    }

    if (file.mimetype?.startsWith("audio")) {
      return <audio key={file.id} controls src={src} />;
    }

    if (!file.mimetype?.startsWith("image") && thumb) {
      href = file.url_private || href;
      src = src.replace(`.${file.filetype}`, ".png");

      return (
        <a key={file.id} href={href} target="_blank">
          <img className="file" src={src} />
        </a>
      );
    }

    return (
      <a key={file.id} href={href} target="_blank">
        {file.name}
      </a>
    );
  });

  return <div className="files">{...fileElements}</div>;
};

interface AvatarProps {
  userId?: string;
}
const Avatar: React.FunctionComponent<AvatarProps> = ({ userId }) => {
  if (!userId) return null;

  const user = users[userId];
  if (!user) return null;

  const ext = path.extname(user?.profile?.image_512! || user?.icons?.image_72!);
  const src = `${base}avatars/${userId}${ext}`;

  return <img className="avatar" src={src} />;
};

interface ParentMessageProps {
  message: ArchiveMessage;
  channelId: string;
}
const ParentMessage: React.FunctionComponent<ParentMessageProps> = (props) => {
  const { message, channelId } = props;
  const hasFiles = !!message.files;

  return (
    <Message message={message} channelId={channelId}>
      {hasFiles ? <Files message={message} channelId={channelId} /> : null}
      {message.replies?.map((reply) => (
        <ParentMessage message={reply} channelId={channelId} key={reply.ts} />
      ))}
    </Message>
  );
};

interface MessageProps {
  message: ArchiveMessage;
  channelId: string;
}
const Message: React.FunctionComponent<MessageProps> = (props) => {
  const { message } = props;
  const identifier = message.user || message.bot_id;
  const username = identifier
    ? users[identifier]?.profile?.display_name || users[identifier]?.real_name || users[identifier]?.name
    : identifier || "Unknown";

  return (
    <div className="message-gutter" id={message.ts}>
      <div className="" data-stringify-ignore="true">
        <Avatar userId={identifier} />
      </div>
      <div className="message-body">
        <span className="sender">{username}</span>
        <span className="timestamp">
          <Timestamp ts={message.ts} />
        </span>
        <br />
        {!message.attachments && <div
          className="text"
          dangerouslySetInnerHTML={slackHTML(message.text)}
        />}
        {(message.attachments || []).map((attachment, index) => {
          return <MessageAttachment key={index} attachment={attachment} />
        })}
        {props.children}
      </div>
    </div>
  );
};

interface MessageAttachmentProps {
  attachment: any;
}
const MessageAttachment: React.FunctionComponent<MessageAttachmentProps> = (props) => {
  const { attachment } = props;

  return (
    <div className="message-attachment">
      {attachment.pretext && <div
        className="message-attachment__pretext"
        dangerouslySetInnerHTML={slackHTML(attachment.pretext)}
      />}
      <div
        className="message-attachment__body"
        style={{borderLeftColor: attachment.color ? '#' + attachment.color.replace(/^#/, '') : null}}
      >
        {attachment.service_name && <div
          className="message-attachment__service"
        >
          {attachment.service_icon && <img src={attachment.service_icon} />}
          <span dangerouslySetInnerHTML={slackHTML(attachment.service_name)} />
        </div>}
        {/* @todo title_link */}
        {attachment.title && <div
          className="message-attachment__title"
          dangerouslySetInnerHTML={slackHTML(attachment.title)}
        />}
        {(attachment.blocks || []).map((block, index) => {
          return <MessageBlock key={index} block={block} />
        })}
        {attachment.text && <div
          className="message-attachment__row"
          dangerouslySetInnerHTML={slackHTML(attachment.text)}
        />}
        {attachment.image_url && <img
          className="message-attachment__image"
          src={attachment.image_url}
          width={attachment.image_width}
          height={attachment.image_height}
        />}
        {(attachment.fields || []).map((field, index) => {
          return (
            <div key={index}>
              <div className="message-attachment__field-title">{field.title}</div>
              <div className="message-attachment__field-value" dangerouslySetInnerHTML={slackHTML(field.value)} />
            </div>
          );
        })}
        {attachment.footer && <div
          className="message-attachment__footer"
        >
          {attachment.footer_icon && <img src={attachment.footer_icon} />}
          <span dangerouslySetInnerHTML={slackHTML(attachment.footer)} />
          {attachment.ts && <Timestamp ts={attachment.ts + '.000'} format=" | d MMM" />}
        </div>}
      </div>
    </div>
  );
}

interface MessagesPageProps {
  messages: Array<ArchiveMessage>;
  channel: Channel;
  index: number;
  total: number;
}
const MessagesPage: React.FunctionComponent<MessagesPageProps> = (props) => {
  const { channel, index, total } = props;
  const messagesJs = fs.readFileSync(MESSAGES_JS_PATH, "utf8");

  // Newest message is first
  const messages = props.messages
    .map((m) => (
      <ParentMessage key={m.ts} message={m} channelId={channel.id!} />
    ))
    .reverse();

  if (messages.length === 0) {
    messages.push(<span key="empty">No messages were ever sent!</span>);
  }

  return (
    <HtmlPage>
      <div style={{ paddingLeft: 10 }}>
        <Header index={index} total={total} channel={channel} />
        <div className="messages-list">{messages}</div>
        <script dangerouslySetInnerHTML={{ __html: messagesJs }} />
      </div>
    </HtmlPage>
  );
};

interface ChannelLinkProps {
  channel: Channel;
}
const ChannelLink: React.FunctionComponent<ChannelLinkProps> = ({
  channel,
}) => {
  let name = channel.name || channel.id;
  let leadSymbol = <span># </span>;

  const channelData = slackArchiveData.channels[channel.id!];
  if (channelData && channelData.messages === 0) {
    return null;
  }

  // Remove the user's name from the group mpdm channel name
  if (me && channel.is_mpim) {
    name = name?.replace(`@${me.name}`, "").replace("  ", " ");
  }

  if (channel.is_im && (channel as any).user) {
    leadSymbol = <Avatar userId={(channel as any).user} />;
  }

  if (channel.is_mpim) {
    leadSymbol = <></>;
    name = name?.replace("Group messaging with: ", "");
  }

  return (
    <li key={name}>
      <a title={name} href={`html/${channel.id!}-0.html`} target="iframe">
        {leadSymbol}
        <span>{name}</span>
      </a>
    </li>
  );
};

interface IndexPageProps {
  channels: Array<Channel>;
}
const IndexPage: React.FunctionComponent<IndexPageProps> = (props) => {
  const { channels } = props;
  const sortedChannels = sortBy(channels, "name");

  const publicChannels = sortedChannels
    .filter(
      (channel) => !channel.is_private && !channel.is_mpim && !channel.is_im
    )
    .map((channel) => <ChannelLink key={channel.id} channel={channel} />);

  const privateChannels = sortedChannels
    .filter(
      (channel) => channel.is_private && !channel.is_im && !channel.is_mpim
    )
    .map((channel) => <ChannelLink key={channel.id} channel={channel} />);

  const dmChannels = sortedChannels
    .filter((channel) => channel.is_im)
    .sort((a, b) => {
      // Self first
      if (me && a.user && a.user === me.id) {
        return -1;
      }

      // Then alphabetically
      if (a.name && b.name) {
        return a.name!.localeCompare(b.name!);
      }

      return 1;
    })
    .map((channel) => <ChannelLink key={channel.id} channel={channel} />);

  const groupChannels = sortedChannels
    .filter((channel) => channel.is_mpim)
    .map((channel) => <ChannelLink key={channel.id} channel={channel} />);

  return (
    <HtmlPage>
      <div id="index">
        <div id="channels">
          <p className="section">Public Channels</p>
          <ul>{publicChannels}</ul>
          <p className="section">Private Channels</p>
          <ul>{privateChannels}</ul>
          <p className="section">DMs</p>
          <ul>{dmChannels}</ul>
          <p className="section">Group DMs</p>
          <ul>{groupChannels}</ul>
        </div>
        <div id="messages">
          <iframe name="iframe" src={`html/${channels[0].id!}-0.html`} />
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `
            const urlSearchParams = new URLSearchParams(window.location.search);
            const channelValue = urlSearchParams.get("c");
            const tsValue = urlSearchParams.get("ts");

            if (channelValue) {
              const iframe = document.getElementsByName('iframe')[0]
              iframe.src = "html/" + decodeURIComponent(channelValue) + '.html' + '#' + (tsValue || '');
            }
            `,
          }}
        />
      </div>
    </HtmlPage>
  );
};

const HtmlPage: React.FunctionComponent = (props) => {
  return (
    <html lang="en">
      <head>
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Slack</title>
        <link rel="stylesheet" href={`${base}style.css`} />
      </head>
      <body>{props.children}</body>
    </html>
  );
};

interface HeaderProps {
  index: number;
  total: number;
  channel: Channel;
}
const Header: React.FunctionComponent<HeaderProps> = (props) => {
  const { channel, index, total } = props;
  let created;

  if (!channel.is_im && !channel.is_mpim) {
    const creator = channel.creator
      ? users[channel.creator]?.name || channel.creator
      : "Unknown";
    const time = channel.created
      ? format(channel.created * 1000, "PPPP")
      : "Unknown";

    created =
      creator && time ? (
        <span className="created">
          Created by {creator} on {time}
        </span>
      ) : null;
  }

  return (
    <div className="header">
      <h1>{channel.name || channel.id}</h1>
      {created}
      <p className="topic">{channel.topic?.value}</p>
      <Pagination channelId={channel.id!} index={index} total={total} />
    </div>
  );
};

interface PaginationProps {
  index: number;
  total: number;
  channelId: string;
}
const Pagination: React.FunctionComponent<PaginationProps> = (props) => {
  const { index, total, channelId } = props;

  if (total === 1) {
    return null;
  }

  const older =
    index + 1 < total ? (
      <span>
        <a href={`${channelId}-${index + 1}.html`}>Older Messages</a>
      </span>
    ) : null;
  const newer =
    index > 0 ? (
      <span>
        <a href={`${channelId}-${index - 1}.html`}>Newer Messages </a>
      </span>
    ) : null;
  const sep = older && newer ? " | " : null;

  let jump = [];

  for (let ji = 0; ji < total; ji++) {
    const className = ji === index ? "current" : "";
    jump.push(
      <a className={className} key={ji} href={`${channelId}-${ji}.html`}>
        {ji}
      </a>
    );
  }

  return (
    <div className="pagination">
      {newer}
      {sep}
      {older}
      <div className="jumper">{jump}</div>
    </div>
  );
};

async function renderIndexPage({ users }: { users: Users }) {
  base = "html/";
  const channels = await getChannels();
  const page = <IndexPage channels={channels} />;

  return renderAndWrite(page, INDEX_PATH);
}

function renderMessagesPage(
  channel: Channel,
  messages: Array<ArchiveMessage>,
  index: number,
  total: number,
  spinner: Ora
) {
  const page = (
    <MessagesPage
      channel={channel}
      messages={messages}
      index={index}
      total={total}
    />
  );

  const filePath = getHTMLFilePath(channel.id!, index);
  spinner.text = `${channel.name || channel.id}: Writing ${
    index + 1
  }/${total} ${filePath}`;
  spinner.render();

  // Update the search index. In messages, the youngest message is first.
  if (messages.length > 0) {
    recordPage(channel.id, messages[messages.length - 1]?.ts);
  }

  return renderAndWrite(page, filePath);
}

async function renderAndWrite(page: JSX.Element, filePath: string) {
  const html = ReactDOMServer.renderToStaticMarkup(page);
  const htmlWDoc = "<!DOCTYPE html>" + html;

  await write(filePath, htmlWDoc);
}

async function createHtmlForChannel({
  channel,
  i,
  total,
}: {
  channel: Channel;
  i: number;
  total: number;
}) {
  const messages = await getMessages(channel.id!, true);
  const chunks = chunk(messages, MESSAGE_CHUNK);
  const spinner = ora(
    `Rendering HTML for ${i + 1}/${total} ${channel.name || channel.id}`
  ).start();

  if (chunks.length === 0) {
    await renderMessagesPage(channel, [], 0, chunks.length, spinner);
  }

  for (const [chunkI, chunk] of chunks.entries()) {
    await renderMessagesPage(channel, chunk, chunkI, chunks.length, spinner);
  }

  spinner.succeed(
    `Rendered HTML for ${i + 1}/${total} ${channel.name || channel.id}`
  );
}

export async function createHtmlForChannels(channels: Array<Channel> = []) {
  console.log(`Creating HTML files...`);

  const _channels = channels.length === 0 ? await getChannels() : channels;
  users = await getUsers();
  slackArchiveData = await getSlackArchiveData();
  me = slackArchiveData.auth?.user_id
    ? users[slackArchiveData.auth?.user_id]
    : null;

  for (const [i, channel] of _channels.entries()) {
    if (!channel.id) {
      console.warn(`Can't create HTML for channel: No id found`, channel);
      continue;
    }

    await createHtmlForChannel({ channel, i, total: _channels.length });
  }

  await renderIndexPage({ users });

  // Copy in fonts & css
  fs.copySync(path.join(_dirname, "../static"), path.join(OUT_DIR, "html/"));
}

if (esMain(import.meta)) {
  createHtmlForChannels();
}
