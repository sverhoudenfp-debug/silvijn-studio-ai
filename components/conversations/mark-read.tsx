"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { markConversationReadAction } from "@/app/actions/conversations";

/**
 * Markeert het geopende gesprek als gelezen zodra de eigenaar het
 * daadwerkelijk ziet (client-effect; één keer per mount, fire-and-forget
 * — de lijst-badge verdwijnt na de refresh van de router-cache).
 */
export function MarkConversationRead({ conversationId, unread }: { conversationId: string; unread: boolean }) {
  const router = useRouter();
  const fired = useRef(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!unread || fired.current) return;
    fired.current = true;
    markConversationReadAction(conversationId)
      .then(() => {
        setDone(true);
        router.refresh();
      })
      .catch(() => {
        /* gelezen-status is weergave, geen productiedata: stille retry bij de volgende open */
      });
  }, [unread, conversationId, router]);
  return done ? null : null;
}
