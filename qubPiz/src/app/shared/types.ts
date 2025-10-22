/**
 * Shared type definitions for the QubPiz application
 * Consolidates all common interfaces to avoid duplication
 */

// ============= Quiz & Game Session =============

export interface Quiz {
  id: number;
  quiz_name: string;
  quiz_date: string;
  status: string;
  created_at: string;
  current_round_id: number | null;
}

export interface GameStatus {
  active: boolean;
  status: string;
  current_round_id: number | null;
  current_round_type: string | null;
  current_round_name: string | null;
  marking_mode: boolean;
}

// ============= Rounds =============

export interface Round {
  id: number;
  game_session_id: number;
  name: string;
  round_type: string;
  round_order: number;
  created_at: string;
}

export interface RoundDisplayData {
  round: {
    id: number;
    name: string;
    round_type: string;
  } | null;
  questions: Question[];
}

// ============= Questions =============

/**
 * Full Question interface (used by MC and question management)
 * Includes the correct answer for grading
 */
export interface Question {
  id: number;
  round_id?: number;
  question_text: string;
  answer?: string;  // Correct answer (MC view)
  correct_answer?: string;  // Alternative field name (marking view)
  image_url: string | null;
  question_order: number;
  created_at?: string;
}

/**
 * Player-facing Question interface (excludes correct answer)
 * Used when displaying questions to players during rounds
 */
export interface PlayerQuestion {
  id: number;
  question_text: string;
  image_url: string | null;
  question_order: number;
}

// ============= Marking =============

export interface Assignment {
  assignment_id: number;
  markee_name: string;
  round_id: number;
  round_name: string;
  round_type: string;
  questions: Question[];
  answers: { [questionId: number]: string };
  marks: { [questionId: number]: number };
}

// ============= UI Helpers =============

/**
 * Grid item for picture round display
 * Used to maintain even grid layout with blank tiles
 */
export interface GridItem {
  question: PlayerQuestion | null;
  isBlank: boolean;
}
