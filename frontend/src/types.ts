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

export interface HistoryTrendPoint {
  attempted_at: string;
  total_score: number;
  moving_average: number;
}

export interface DifficultyPerformanceItem {
  difficulty: DifficultyLevel;
  average_score: number;
  attempts: number;
}

export interface QuestionTypePerformanceItem {
  question_type: QuestionType;
  ability_score: number;
  answered: number;
}

export interface ErrorTypeBreakdownItem {
  error_type: string;
  count: number;
  share: number;
}

export interface LearningInsightsResponse {
  history_trend: HistoryTrendPoint[];
  difficulty_performance: DifficultyPerformanceItem[];
  question_type_performance: QuestionTypePerformanceItem[];
  error_type_breakdown: ErrorTypeBreakdownItem[];
  learning_profile_overview: LearningProfileOverviewItem[];
  sampled_attempt_count: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture_url: string | null;
  plan: string;
  is_admin: boolean;
  daily_quiz_limit: number;
  daily_retake_limit: number;
  learning_profile_enabled: boolean;
}

export interface LearningProfileEntry {
  domain: string;
  status: string;
  grade: string;
}

export interface LearningProfileResponse {
  enabled: boolean;
  entries: LearningProfileEntry[];
}

export interface LearningProfileOverviewItem {
  domain: string;
  grade: string;
  grade_score: number;
  status: string;
}

export interface DailyQuotaStatus {
  quizzes_generated_today: number;
  quiz_limit_per_day: number;
  retakes_today: number;
  retake_limit_per_day: number;
}

export interface AdminUserSummary {
  id: string;
  name: string;
  email: string;
  plan: string;
  is_admin: boolean;
  daily_quiz_limit: number;
  daily_retake_limit: number;
  quizzes_generated_today: number;
  retakes_today: number;
  total_quizzes: number;
  total_attempts: number;
  created_at: string;
  last_login_at: string | null;
}
