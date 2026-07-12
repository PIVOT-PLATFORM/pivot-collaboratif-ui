/**
 * Structured whiteboard domain model — ported from the PouetPouet reference
 * (`apps/web/src/hooks/board-types.ts`).
 *
 * Content encodings are **load-bearing** and kept byte-compatible with the
 * backend / existing data:
 * - `TEXT` / `LABEL` → plain text, or a rich-text formatting JSON (see `card-format.ts`)
 * - `TABLE` → JSON `{ rows, colW }` (see `table.ts`)
 * - `SHAPE` → `'type|stroke|fill|opacity[|rotation]'`
 * - `DRAW` → SVG path `d` string
 * - `IMAGE` → data URL / URL
 */

/** A custom-field value attached to a single card. */
export interface FieldValue {
  id: string;
  cardId: string;
  fieldId: string;
  value: string;
}

/** Open-Graph link preview metadata, resolved server-side for URL text cards. */
export interface OgMeta {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

/** Discriminant string for a card's rendering kind. */
export type CardType = 'TEXT' | 'LABEL' | 'IMAGE' | 'DRAW' | 'TABLE' | 'SHAPE';

/** A single board object. `content` encoding depends on `type` (see file header). */
export interface Card {
  id: string;
  boardId: string;
  type: CardType | string;
  content: string;
  meta?: OgMeta | null;
  posX: number;
  posY: number;
  width: number;
  height: number;
  color: string;
  groupId: string | null;
  groupColor: string | null;
  locked: boolean;
  layer: number;
  fieldValues: FieldValue[];
}

export type ConnShape = 'straight' | 'curved' | 'orthogonal';
export type ConnArrow = 'none' | 'end' | 'start' | 'both';

/** A directed link between two cards. */
export interface Connection {
  id: string;
  boardId: string;
  fromId: string;
  toId: string;
  label: string | null;
  color: string | null;
  shape: ConnShape;
  arrow: ConnArrow;
  dashed: boolean;
  width: number;
}

export type ConnectionPatch = Partial<
  Pick<Connection, 'label' | 'color' | 'shape' | 'arrow' | 'dashed' | 'width'>
>;

/**
 * A frame / section box. When `active`, dragging the frame carries every
 * unlocked card inside it (and their groups); when inactive it moves alone.
 */
export interface Frame {
  id: string;
  boardId: string;
  title: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  color: string;
  active: boolean;
  layer: number;
}

export type BoardFieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT';

/** A custom-field definition on the board schema. */
export interface BoardField {
  id: string;
  boardId: string;
  name: string;
  emoji: string | null;
  type: BoardFieldType;
  options: string[] | null;
  order: number;
}

export type BoardRole = 'OWNER' | 'EDITOR' | 'VIEWER';

/** Full board payload delivered when opening a board. */
export interface BoardDetail {
  id: string;
  name: string;
  description: string | null;
  coverImage: string | null;
  maxParticipants: number | null;
  enabledActivities: string[] | null;
  templateDraftOf: string | null;
  cards: Card[];
}

/** A participant currently present on the board (presence stream). */
export interface PresenceUser {
  id: string;
  name: string;
  avatar: string | null;
}

/** A board member with a persisted access role. */
export interface BoardMember {
  id: string;
  name: string;
  avatar: string | null;
  role: BoardRole;
}

/** A live remote cursor position. */
export interface RemoteCursor {
  userId: string;
  name: string;
  avatar: string | null;
  x: number;
  y: number;
}

/** Soft-lock: another user is currently editing a card. */
export interface RemoteEditor {
  cardId: string;
  userId: string;
  name: string;
}

/** A single vote cast during a vote session. */
export interface BoardVote {
  id: string;
  sessionId: string;
  cardId: string;
  userId: string;
  createdAt: string;
}

/** A dot-voting session over the board's cards. */
export interface VoteSession {
  id: string;
  boardId: string;
  status: 'ACTIVE' | 'CLOSED';
  votesPerPerson: number;
  timerSeconds: number | null;
  timerEndsAt: string | null;
  voterIds: string[];
  votes: BoardVote[];
  createdAt: string;
  closedAt: string | null;
}

/** Card payload copied to the clipboard (localStorage), portable across boards. */
export interface ClipboardCard {
  type: string;
  content: string;
  color: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  layer: number;
  groupId: string | null;
  groupColor: string | null;
}
