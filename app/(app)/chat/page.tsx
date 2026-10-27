import { ChatView } from "@/components/chat/chat-view";
import { requirePageAccess } from "@/lib/permissions-server";

export default async function ChatPage() {
  await requirePageAccess("chat");
  return <ChatView />;
}
