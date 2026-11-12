import type { Request, Response } from 'express';

export type ProjectUser = {
  id: number;
  name: string;
  role: 'organizer' | 'manager' | 'member';
  teamId: number | null;
};

export type ProjectRequest = Request & {
  projectUser: ProjectUser;
  projectTeam?: { id: number; campusId: number; name: string; isOperational: boolean };
};

export function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

/** Strict integer query value; undefined when absent, null when invalid. */
export function queryInt(value: unknown, min: number, max: number): number | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{1,10}$/.test(value)) return null;
  const number = Number(value);
  return number >= min && number <= max ? number : null;
}
