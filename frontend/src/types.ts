export type DifficultyLevel =
  | "very_easy"
  | "easy"
  | "medium"
  | "hard"
  | "very_hard";

export type ScoreBand = 0 | 25 | 50 | 75 | 100;

export type QuestionType =
  | "是非題"
  | "單選題"
  | "多選題"
  | "情境題"
  | "錯題改寫";

export interface SummarySchema {
  points: Record<string, string>;
}

export interface SpecItem {
  type: QuestionType;
  count: number;
  goal: string;
}

export interface SpecSchema {
  items: SpecItem[];
}

export interface QuestionItem {
  type: QuestionType;
  stem: string;
  options: string[];
  answer: string | string[];
}

export interface QuizHistoryItem {
  id: string;
  title: string;
  difficulty: DifficultyLevel;
  numbers: number;
  created_at: string;
}

export interface QuizWorkflowResponse extends QuizHistoryItem {
  content: string;
  preference: string;
  summary: SummarySchema;
  spec: SpecSchema;
  questions: QuestionItem[];
  submitted_answers: Record<string, string | string[]> | null;
  score_result: QuizScoreResponse | null;
}

export interface QuizScoreAnswerItem {
  question_index: number;
  answer: string | string[];
}

export interface QuizScoreQuestionResult {
  question_index: number;
  type: QuestionType;
  max_score: number;
  earned_score: number;
  correctness_ratio: number;
  user_answer: string | string[];
  correct_answer: string | string[];
  feedback: string | null;
  rubric_band: ScoreBand | null;
}

export interface QuizScoreResponse {
  quiz_id: string;
  total_score: number;
  max_score: number;
  results: QuizScoreQuestionResult[];
}
