import { Message as SlackMessage } from "@slack/web-api/dist/response/ConversationsHistoryResponse";
import { Channel as SlackChannel } from "@slack/web-api/dist/response/ConversationsListResponse";
import { User as SlackUser } from "@slack/web-api/dist/response/UsersInfoResponse";
import { Bot as SlackBot } from "@slack/web-api/dist/response/BotsInfoResponse";
import { File as SlackFile } from "@slack/web-api/dist/response/FilesInfoResponse";
import { AuthTestResponse } from "@slack/web-api";

export type User = SlackUser;
export type Bot = SlackBot;

export type Users = Record<string, User>;
export type Bots = Record<string, Bot>;

export interface ArchiveMessage extends SlackMessage {
  replies?: Array<SlackMessage>;
}

export type Message = SlackMessage;

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
