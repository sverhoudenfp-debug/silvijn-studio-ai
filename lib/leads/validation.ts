import { z } from "zod";
import { leadLifecycleStates } from "./lifecycle";
export const transitionInput = z.object({ leadId:z.uuid(), expected:z.enum(leadLifecycleStates), next:z.enum(leadLifecycleStates), reason:z.string().trim().min(3).max(2000), projectId:z.uuid().nullable().optional(), messageId:z.uuid().nullable().optional() });
