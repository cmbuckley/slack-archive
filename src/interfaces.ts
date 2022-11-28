import {
  Message as SlackMessage,
  Block as SlackBlock,
  Attachment as SlackAttachment,
  Accessory as SlackAccessory,
  AccessoryElement as SlackAccessoryElement,
  PurpleElement as SlackPurpleElement,
} from "@slack/web-api/dist/response/ConversationsHistoryResponse";
import { Channel as SlackChannel } from "@slack/web-api/dist/response/ConversationsListResponse";
import { User as SlackUser } from "@slack/web-api/dist/response/UsersInfoResponse";
import { File as SlackFile } from "@slack/web-api/dist/response/FilesInfoResponse";
import { AuthTestResponse } from "@slack/web-api";

export type User = SlackUser;

export type Users = Record<string, User>;

export interface ArchiveMessage extends SlackMessage {
  replies?: Array<SlackMessage>;
}

export type Message = SlackMessage;

export type Block = SlackBlock;

export type Attachment = SlackAttachment;

export type Accessory = SlackAccessory;

export type AccessoryElement = SlackAccessoryElement;

export type PurpleElement = SlackPurpleElement;

export type Channel = SlackChannel;

export type File = SlackFile;

export type SearchPageIndex = Record<string, Array<string>>;

export type SearchFile = {
  users: Record<string, string>; // userId -> userName
  channels: Record<string, string>; // channelId -> channelName
  messages: Record<string, Array<SearchMessage>>;
  pages: SearchPageIndex;
};

export type SearchMessage = {
  m?: string; // Message
  u?: string; // User
  t?: string; // Timestamp
  c?: string; // Channel
};

export interface SlackArchiveChannelData {
  messages: number;
  fullyDownloaded: boolean;
}

export interface SlackArchiveData {
  channels: Record<string, SlackArchiveChannelData>;
  auth?: AuthTestResponse;
}
