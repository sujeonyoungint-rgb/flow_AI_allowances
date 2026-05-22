import { ProjectMapping } from "./types";

export function getProjects(): ProjectMapping[] {
  try {
    return JSON.parse(process.env.FLOW_PROJECTS || "[]");
  } catch {
    return [];
  }
}

export const CLIENT_CONFIG = {
  TARGET_TEMPLATE_TYPES: ["91"] as string[],
};