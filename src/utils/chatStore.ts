let chatIds: number[] = [];

export const saveChatId = (id: number) => {
  if (!chatIds.includes(id)) {
    chatIds.push(id);
  }
};

export const getAllChatIds = (): number[] => {
  return chatIds;
};
export const fetchChatIdsFromSheet = async (): Promise<number[]> => {
  try {
    const response = await fetch('https://script.google.com/macros/s/AKfycbzHPhcv79YQyIx6t-59fsc6Czm9WgL6Y4HOP2JgX4gJyi3KjZqbXOGY-zmpyceW32VI/exec');
    const data = await response.json();

    const ids = data.map((entry: any) => Number(entry.id)).filter((id: number) => !isNaN(id));
    return ids;
  } catch (error) {
    console.error('Failed to fetch chat IDs from Google Sheet:', error);
    return [];
  }
};
