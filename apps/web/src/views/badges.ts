import type { channel, requestPriority, requestStatus, requestType } from "@request-agent/core";
import { html } from "hono/html";

import { channelLabels, priorityLabels, statusLabels, typeLabels } from "./labels.ts";
import type { Fragment } from "./layout.ts";

// Colors of the badges, defined in the stylesheet. Gray is the neutral one.
type Tone = "red" | "yellow" | "green" | "blue" | "gray";

type Value<T extends { enumValues: [string, ...string[]] }> = T["enumValues"][number];

const statusTones: Record<Value<typeof requestStatus>, Tone> = {
  NEW: "green",
  IN_PROGRESS: "yellow",
  WAITING_FOR_INFO: "gray",
  RESOLVED: "gray",
  CLOSED: "gray",
};

const priorityTones: Record<Value<typeof requestPriority>, Tone> = {
  CRITICAL: "red",
  HIGH: "red",
  MEDIUM: "yellow",
  LOW: "blue",
};

const badge = (label: string, tone: Tone): Fragment =>
  html`<span class="badge badge-${tone}">${label}</span>`;

export const statusBadge = (status: Value<typeof requestStatus>) =>
  badge(statusLabels[status], statusTones[status]);

export const priorityBadge = (priority: Value<typeof requestPriority> | null) =>
  priority === null ? "—" : badge(priorityLabels[priority], priorityTones[priority]);

export const typeBadge = (type: Value<typeof requestType>) =>
  badge(typeLabels[type], type === "SUPPORT" ? "blue" : "gray");

export const channelBadge = (source: Value<typeof channel>) => badge(channelLabels[source], "gray");
