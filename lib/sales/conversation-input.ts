import { z } from "zod";
export const confirmedReplyInput=z.object({leadId:z.uuid(),sender:z.email().max(500),subject:z.string().max(1000),body:z.string().trim().min(1).max(50000),receivedAt:z.iso.datetime(),requestId:z.uuid(),confirmedReply:z.literal(true),outreachId:z.uuid().nullable().optional(),threadKey:z.string().min(1).max(300).default("manual")});
