// utils/groupSettings.ts

export const isGroupOrSupergroup = (chatType: string): boolean => {
  return chatType === 'group' || chatType === 'supergroup';
};

export const isPrivateChat = (chatType: string): boolean => {
  return chatType === 'private';
};

export const isChannel = (chatType: string): boolean => {
  return chatType === 'channel';
};
