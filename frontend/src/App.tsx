import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useRef, useState, type FormEvent, type MutableRefObject, type ReactNode } from "react";

import type {
  AdminUserSummary,
  AuthUser,
  DailyQuotaStatus,
  DifficultyLevel,
  LearningInsightsResponse,
  LearningProfileOverviewItem,
  LearningProfileResponse,
  QuestionItem,
  QuizHistoryItem,
  QuizScoreQuestionResult,
  QuizScoreResponse,
  QuizWorkflowResponse,
} from "./types";

type QuizPhase = "answering" | "review";
type UserAnswer = string | string[];
type ChoiceStatus = "neutral" | "selected" | "correct" | "missed" | "incorrect";
type DownloadDocumentType = "quiz" | "report";
type AbilityChartMode = "radar" | "bars";
type AuthStatus = "loading" | "authenticated" | "unauthenticated";
type AuthMode = "login" | "signup";

const APP_ORIGIN =
  typeof window === "undefined" ? { protocol: "http:", hostname: "127.0.0.1" } : window.location;
const DEFAULT_API_BASE_URL = `${APP_ORIGIN.protocol}//${APP_ORIGIN.hostname || "127.0.0.1"}:8000/api`;
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? DEFAULT_API_BASE_URL;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";

const DIFFICULTY_OPTIONS: Array<{ value: DifficultyLevel; label: string }> = [
  { value: "very_easy", label: "Very Easy" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
  { value: "very_hard", label: "Very Hard" },
];

const MAX_CONTENT_LENGTH = 10000;
const MAX_QUESTION_COUNT = 25;
const MAX_TITLE_LENGTH = 20;
const DEFAULT_PREFERENCE = "";
const DEFAULT_NUMBERS = "10";

const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  very_easy: "Very Easy",
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  very_hard: "Very Hard",
};

const QUESTION_TYPE_LABELS: Record<string, string> = {
  "是非題": "True / False",
  "單選題": "Single Choice",
  "多選題": "Multiple Choice",
  "情境題": "Scenario",
  "錯題改寫": "Rewrite",
};

const ERROR_COLORS = ["#2563eb", "#14b8a6", "#f97316", "#ef4444", "#a855f7"];

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    ...init,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const rawBody = response.status === 204 ? "" : await response.text();
  const payload =
    contentType.includes("application/json") && rawBody
      ? (JSON.parse(rawBody) as T)
      : null;

  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : `Request failed with status ${response.status}`;
    throw new Error(detail);
  }

  return payload as T;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "FL";
}

function summarizeAnswer(answer: string | string[]): string {
  return Array.isArray(answer) ? answer.join(", ") : answer;
}

function formatQuestionCount(count: number): string {
  return `${count} ${count === 1 ? "Question" : "Questions"}`;
}

function formatScoreValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatNumericMetric(value: number | string): string {
  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) ? formatScoreValue(numericValue) : String(value);
}

function normalizeSubmittedAnswers(
  submittedAnswers: Record<string, string | string[]> | null | undefined,
): Record<number, UserAnswer> {
  if (!submittedAnswers) {
    return {};
  }

  return Object.entries(submittedAnswers).reduce<Record<number, UserAnswer>>((accumulator, [key, value]) => {
    const questionIndex = Number(key);
    if (Number.isInteger(questionIndex) && questionIndex >= 0) {
      accumulator[questionIndex] = value;
    }
    return accumulator;
  }, {});
}

function toHistoryItem(quiz: QuizWorkflowResponse): QuizHistoryItem {
  return {
    id: quiz.id,
    title: quiz.title,
    difficulty: quiz.difficulty,
    numbers: quiz.numbers,
    created_at: quiz.created_at,
    updated_at: quiz.updated_at,
  };
}

function formatChartDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function InsightCard({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="insight-card">
      <div className="insight-card__header">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="insight-card__actions">{actions}</div>}
      </div>
      <div className="insight-card__body">{children}</div>
    </section>
  );
}

function UserAvatar({ user, className }: { user: AuthUser; className?: string }) {
  if (user.picture_url) {
    return <img className={className} src={user.picture_url} alt={user.name} referrerPolicy="no-referrer" />;
  }

  return <span className={className}>{getInitials(user.name)}</span>;
}

function AuthScreen({
  mode,
  authError,
  isAuthenticating,
  onModeChange,
  googleButtonRef,
}: {
  mode: AuthMode;
  authError: string | null;
  isAuthenticating: boolean;
  onModeChange: (mode: AuthMode) => void;
  googleButtonRef: MutableRefObject<HTMLDivElement | null>;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-hero">
        <div className="auth-hero__badge">Fastlearn</div>
        <h1>Turn dense study notes into focused quizzes with durable progress tracking.</h1>
        <p>
          Sign in once with Google, keep your browser session, and store quizzes, scores, and insights
          under your own workspace.
        </p>
        <div className="auth-hero__grid">
          <article>
            <span>Google login</span>
            <p>Verified Google sign-in with persistent browser sessions.</p>
          </article>
          <article>
            <span>Personal workspace</span>
            <p>Your quizzes, attempts, scores, and analytics stay scoped to your account.</p>
          </article>
          <article>
            <span>Study continuity</span>
            <p>Return to the same workspace after refresh without signing in again.</p>
          </article>
        </div>
      </section>

      <section className="auth-card">
        <p className="results__eyebrow">{mode === "login" ? "Login" : "Sign Up"}</p>
        <h2>{mode === "login" ? "Welcome back to Fastlearn" : "Create your Fastlearn workspace"}</h2>
        <p className="auth-card__copy">
          {mode === "login"
            ? "Use your Google account to continue where you left off."
            : "Use your Google account to create a personal learning workspace."}
        </p>

        <div className="segmented-control segmented-control--auth">
          <button
            type="button"
            className={mode === "login" ? "is-active" : ""}
            onClick={() => onModeChange("login")}
          >
            Login
          </button>
          <button
            type="button"
            className={mode === "signup" ? "is-active" : ""}
            onClick={() => onModeChange("signup")}
          >
            Sign Up
          </button>
        </div>

        <div className="auth-google-slot">
          {GOOGLE_CLIENT_ID ? (
            <div
              ref={(node) => {
                googleButtonRef.current = node;
              }}
            />
          ) : (
            <div className="auth-card__warning">
              Missing <code>VITE_GOOGLE_CLIENT_ID</code>. Add it to your frontend environment first.
            </div>
          )}
        </div>

        {isAuthenticating && (
          <div className="auth-card__status">
            <Spinner />
            <span>Signing you in...</span>
          </div>
        )}
        {authError && <div className="alert-banner">{authError}</div>}
      </section>
    </main>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

function formatChoiceLabel(value: string): string {
  if (value === "O") {
    return "True";
  }

  if (value === "X") {
    return "False";
  }

  return value;
}

function getQuestionTypeLabel(questionType: string): string {
  return QUESTION_TYPE_LABELS[questionType] ?? questionType;
}

function formatUserAnswer(question: QuestionItem, answer: UserAnswer | undefined): string {
  if (answer === undefined || answer === "") {
    return "No answer provided.";
  }

  if (question.type === "是非題") {
    return formatChoiceLabel(String(answer));
  }

  if (Array.isArray(answer)) {
    return answer.length > 0 ? answer.join(", ") : "No answer provided.";
  }

  return String(answer);
}

function formatOfficialAnswer(question: QuestionItem): string {
  if (question.type === "是非題") {
    return formatChoiceLabel(String(question.answer));
  }

  return summarizeAnswer(question.answer);
}

function formatOptionText(option: string): string {
  return option.replace(/^\s*[A-Z][\.\)、]\s*/u, "").trim();
}

function sanitizeFileName(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 60) || "fastlearn_quiz";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildDownloadDocumentMarkup({
  quiz,
  scoreResult,
  answers,
  documentType,
}: {
  quiz: QuizWorkflowResponse;
  scoreResult: QuizScoreResponse | null;
  answers: Record<number, UserAnswer>;
  documentType: DownloadDocumentType;
}): string {
  const metadata = [
    `Updated: ${formatDate(quiz.updated_at)}`,
    `Difficulty: ${DIFFICULTY_LABELS[quiz.difficulty]}`,
    `Question Count: ${formatQuestionCount(quiz.numbers)}`,
  ];

  if (documentType === "report" && scoreResult) {
    metadata.push(`Score: ${formatScoreValue(scoreResult.total_score)} / ${formatScoreValue(scoreResult.max_score)}`);
  }

  const questionMarkup = quiz.questions.map((question, index) => {
    const scoreEntry = scoreResult?.results.find((item) => item.question_index === index);
    const userAnswer = answers[index];
    const optionsMarkup = question.options
      .map((option, optionIndex) => {
        const letter = String.fromCharCode(65 + optionIndex);
        return `<li><span class="option-letter">${letter}.</span>${escapeHtml(formatOptionText(option))}</li>`;
      })
      .join("");

    return `
      <article class="pdf-question">
        <div class="pdf-question__head">
          <span class="pdf-question__index">${String(index + 1).padStart(2, "0")}</span>
          <span class="pdf-question__type">${escapeHtml(getQuestionTypeLabel(question.type))}</span>
          ${
            documentType === "report" && scoreEntry
              ? `<span class="pdf-question__score">${formatScoreValue(scoreEntry.earned_score)} / ${formatScoreValue(scoreEntry.max_score)}</span>`
              : ""
          }
        </div>
        <h2>${escapeHtml(question.stem)}</h2>
        ${
          question.options.length > 0
            ? `<ol class="pdf-options">${optionsMarkup}</ol>`
            : ""
        }
        <div class="pdf-answer-block pdf-answer-block--official">
          <span>Official Answer</span>
          <p>${escapeHtml(formatOfficialAnswer(question))}</p>
        </div>
        ${
          documentType === "report" && scoreResult
            ? `
              <div class="pdf-answer-block">
                <span>Your Answer</span>
                <p>${escapeHtml(formatUserAnswer(question, userAnswer))}</p>
              </div>
              ${
                scoreEntry?.feedback
                  ? `
                    <div class="pdf-answer-block">
                      <span>Feedback</span>
                      <p>${escapeHtml(scoreEntry.feedback)}</p>
                    </div>
                  `
                  : ""
              }
            `
            : ""
        }
      </article>
    `;
  }).join("");

  return `
    <div class="pdf-shell">
      <style>
        .pdf-shell {
          width: 794px;
          padding: 44px;
          box-sizing: border-box;
          background: linear-gradient(180deg, #f8fbff 0%, #ffffff 100%);
          color: #0f172a;
          font-family: "Plus Jakarta Sans", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif;
        }
        .pdf-header {
          padding: 26px 28px;
          border: 1px solid rgba(37, 99, 235, 0.12);
          border-radius: 28px;
          background: linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 64, 175, 0.96) 100%);
          color: #f8fafc;
        }
        .pdf-header h1 {
          margin: 0;
          font-size: 34px;
          line-height: 1;
          letter-spacing: -0.06em;
        }
        .pdf-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 16px;
        }
        .pdf-meta span {
          padding: 8px 12px;
          border-radius: 999px;
          font-size: 12px;
          background: rgba(226, 232, 240, 0.14);
          color: #e2e8f0;
        }
        .pdf-section-title {
          margin: 28px 0 14px;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #64748b;
        }
        .pdf-question {
          margin-bottom: 18px;
          padding: 22px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 16px 34px rgba(15, 23, 42, 0.05);
          page-break-inside: avoid;
        }
        .pdf-question__head {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 14px;
        }
        .pdf-question__index {
          font-weight: 800;
          color: #1d4ed8;
        }
        .pdf-question__type,
        .pdf-question__score {
          padding: 7px 12px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          background: rgba(219, 234, 254, 0.92);
          color: #1d4ed8;
        }
        .pdf-question__score {
          margin-left: auto;
          background: rgba(15, 23, 42, 0.08);
          color: #0f172a;
        }
        .pdf-question h2 {
          margin: 0;
          font-size: 18px;
          line-height: 1.55;
        }
        .pdf-options {
          margin: 16px 0 0;
          padding: 0;
          list-style: none;
        }
        .pdf-options li {
          display: flex;
          gap: 10px;
          margin-bottom: 8px;
          padding: 12px 14px;
          border: 1px solid rgba(148, 163, 184, 0.16);
          border-radius: 16px;
          background: rgba(248, 250, 252, 0.96);
        }
        .option-letter {
          min-width: 22px;
          font-weight: 800;
          color: #2563eb;
        }
        .pdf-answer-block {
          margin-top: 14px;
          padding: 14px 16px;
          border-radius: 18px;
          background: rgba(248, 250, 252, 0.98);
        }
        .pdf-answer-block--official {
          background: rgba(239, 246, 255, 0.96);
        }
        .pdf-answer-block span {
          display: block;
          margin-bottom: 6px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #64748b;
        }
        .pdf-answer-block p {
          margin: 0;
          font-size: 14px;
          line-height: 1.6;
          color: #334155;
          white-space: pre-wrap;
        }
      </style>
      <header class="pdf-header">
        <h1>${escapeHtml(quiz.title)}</h1>
        <div class="pdf-meta">
          ${metadata.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
        </div>
      </header>
      <p class="pdf-section-title">${documentType === "quiz" ? "Question Pack" : "Report Card"}</p>
      ${questionMarkup}
    </div>
  `;
}

async function downloadQuizPdf({
  quiz,
  scoreResult,
  answers,
  documentType,
}: {
  quiz: QuizWorkflowResponse;
  scoreResult: QuizScoreResponse | null;
  answers: Record<number, UserAnswer>;
  documentType: DownloadDocumentType;
}) {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-100000px";
  container.style.top = "0";
  container.style.zIndex = "-1";
  container.innerHTML = buildDownloadDocumentMarkup({
    quiz,
    scoreResult,
    answers,
    documentType,
  });

  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container.firstElementChild as HTMLElement, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
    });
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imageData = canvas.toDataURL("image/png");
    const imageWidth = pageWidth;
    const imageHeight = (canvas.height * imageWidth) / canvas.width;
    let heightLeft = imageHeight;
    let position = 0;

    pdf.addImage(imageData, "PNG", 0, position, imageWidth, imageHeight, undefined, "FAST");
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imageHeight;
      pdf.addPage();
      pdf.addImage(imageData, "PNG", 0, position, imageWidth, imageHeight, undefined, "FAST");
      heightLeft -= pageHeight;
    }

    const fileBase = sanitizeFileName(quiz.title);
    pdf.save(`${fileBase}_${documentType === "quiz" ? "quiz" : "report"}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}

function getChoiceOptionStatus(
  value: string,
  userAnswer: UserAnswer | undefined,
  correctAnswer: string | string[],
): Exclude<ChoiceStatus, "selected"> {
  const selectedValues = new Set(Array.isArray(userAnswer) ? userAnswer : userAnswer ? [userAnswer] : []);
  const correctValues = new Set(Array.isArray(correctAnswer) ? correctAnswer : [correctAnswer]);
  const isSelected = selectedValues.has(value);
  const isCorrect = correctValues.has(value);

  if (isSelected && isCorrect) {
    return "correct";
  }

  if (!isSelected && isCorrect) {
    return "missed";
  }

  if (isSelected && !isCorrect) {
    return "incorrect";
  }

  return "neutral";
}

function getReviewStatusLabel(
  question: QuestionItem,
  status: ChoiceStatus,
): string | null {
  if (question.type !== "多選題") {
    return null;
  }

  if (status === "correct") {
    return "Correct Pick";
  }

  if (status === "incorrect") {
    return "Wrong Pick";
  }

  if (status === "missed") {
    return "Missed Answer";
  }

  return null;
}

function QuestionCard({
  question,
  index,
  phase,
  userAnswer,
  scoreResult,
  onSingleAnswer,
  onToggleMultiAnswer,
  onTextAnswer,
}: {
  question: QuestionItem;
  index: number;
  phase: QuizPhase;
  userAnswer: UserAnswer | undefined;
  scoreResult?: QuizScoreQuestionResult;
  onSingleAnswer: (value: string) => void;
  onToggleMultiAnswer: (value: string) => void;
  onTextAnswer: (value: string) => void;
}) {
  const trueFalseOptions = [
    { value: "O", label: "True" },
    { value: "X", label: "False" },
  ];
  const isReview = phase === "review";
  const selectedMultiValues = new Set(Array.isArray(userAnswer) ? userAnswer : []);
  const selectedSingleValue = typeof userAnswer === "string" ? userAnswer : "";
  const reviewedAnswer = scoreResult?.user_answer ?? userAnswer;

  return (
    <article className="question-card">
      <div className="question-card__header">
        <div className="question-card__heading">
          <span className="question-card__index">{String(index + 1).padStart(2, "0")}</span>
          <span className="question-card__type">{getQuestionTypeLabel(question.type)}</span>
        </div>
        {isReview && scoreResult && (
          <span className="question-card__score">
            {formatScoreValue(scoreResult.earned_score)} / {formatScoreValue(scoreResult.max_score)}
          </span>
        )}
      </div>

      <p className="question-card__stem">{question.stem}</p>

      {question.type === "是非題" && (
        <div className="question-card__choices">
          {trueFalseOptions.map((option) => {
            const status = isReview
              ? getChoiceOptionStatus(option.value, userAnswer, String(question.answer))
              : selectedSingleValue === option.value
                ? "selected"
                : "neutral";

            return (
              <button
                key={`${question.stem}-${option.value}`}
                type="button"
                className={`choice-button choice-button--${status}`}
                onClick={() => !isReview && onSingleAnswer(option.value)}
                disabled={isReview}
              >
                <span className="choice-button__marker">{option.label.slice(0, 1)}</span>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {(question.type === "單選題" || question.type === "多選題") && (
        <ol className="question-card__options">
          {question.options.map((option, optionIndex) => {
            const letter = String.fromCharCode(65 + optionIndex);
            const status = isReview
              ? getChoiceOptionStatus(letter, userAnswer, question.answer)
              : question.type === "多選題"
                ? selectedMultiValues.has(letter)
                  ? "selected"
                  : "neutral"
                : selectedSingleValue === letter
                  ? "selected"
                  : "neutral";

            return (
              <li key={`${question.stem}-${letter}`}>
                <button
                  type="button"
                  className={`choice-button choice-button--${status}`}
                  onClick={() =>
                    !isReview &&
                    (question.type === "多選題"
                      ? onToggleMultiAnswer(letter)
                      : onSingleAnswer(letter))
                  }
                  disabled={isReview}
                >
                  <span className="choice-button__marker">{letter}</span>
                  <span className="choice-button__content">
                    <span>{formatOptionText(option)}</span>
                    {isReview && getReviewStatusLabel(question, status) && (
                      <span className={`choice-button__tag choice-button__tag--${status}`}>
                        {getReviewStatusLabel(question, status)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {isReview && question.type === "多選題" && (
        <div className="question-card__legend">
          <span className="question-card__legend-item question-card__legend-item--correct">
            Correct Pick
          </span>
          <span className="question-card__legend-item question-card__legend-item--incorrect">
            Wrong Pick
          </span>
          <span className="question-card__legend-item question-card__legend-item--missed">
            Missed Answer
          </span>
        </div>
      )}

      {(question.type === "情境題" || question.type === "錯題改寫") && !isReview && (
        <div className="question-card__essay">
          <textarea
            value={typeof userAnswer === "string" ? userAnswer : ""}
            onChange={(event) => onTextAnswer(event.target.value)}
            placeholder="Write your answer here..."
            rows={5}
          />
        </div>
      )}

      {isReview && (
        <div className="question-card__review">
          <div className="question-card__review-block">
            <span className="question-card__answer-label">Your Answer</span>
            <p>{formatUserAnswer(question, reviewedAnswer)}</p>
          </div>
          <div className="question-card__review-block question-card__review-block--official">
            <span className="question-card__answer-label">Official Answer</span>
            <p>{formatOfficialAnswer(question)}</p>
          </div>
          {scoreResult?.feedback && (
            <div className="question-card__review-block question-card__review-block--feedback">
              <span className="question-card__answer-label">
                {scoreResult.rubric_band !== null ? `AI Feedback · ${scoreResult.rubric_band}%` : "Review"}
              </span>
              <p>{scoreResult.feedback}</p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [personalizeModalOpen, setPersonalizeModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [clearDataConfirmOpen, setClearDataConfirmOpen] = useState(false);
  const [knowledgeModalOpen, setKnowledgeModalOpen] = useState(false);
  const [insightsModalOpen, setInsightsModalOpen] = useState(false);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [history, setHistory] = useState<QuizHistoryItem[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null);
  const [currentQuiz, setCurrentQuiz] = useState<QuizWorkflowResponse | null>(null);
  const [content, setContent] = useState("");
  const [preference, setPreference] = useState(DEFAULT_PREFERENCE);
  const [difficulty, setDifficulty] = useState<DifficultyLevel>("medium");
  const [numbersInput, setNumbersInput] = useState(DEFAULT_NUMBERS);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [isDeletingQuiz, setIsDeletingQuiz] = useState(false);
  const [isScoringQuiz, setIsScoringQuiz] = useState(false);
  const [isDownloadingDocument, setIsDownloadingDocument] = useState(false);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [isLoadingLearningProfile, setIsLoadingLearningProfile] = useState(false);
  const [isLoadingAdminUsers, setIsLoadingAdminUsers] = useState(false);
  const [isSavingAdminAccess, setIsSavingAdminAccess] = useState<string | null>(null);
  const [isSavingLearningProfileSettings, setIsSavingLearningProfileSettings] = useState(false);
  const [deletingLearningProfileDomain, setDeletingLearningProfileDomain] = useState<string | null>(null);
  const [quizPhase, setQuizPhase] = useState<QuizPhase>("answering");
  const [abilityChartMode, setAbilityChartMode] = useState<AbilityChartMode>("radar");
  const [downloadTarget, setDownloadTarget] = useState<DownloadDocumentType>("quiz");
  const [userAnswers, setUserAnswers] = useState<Record<number, UserAnswer>>({});
  const [scoreResult, setScoreResult] = useState<QuizScoreResponse | null>(null);
  const [insights, setInsights] = useState<LearningInsightsResponse | null>(null);
  const [learningProfile, setLearningProfile] = useState<LearningProfileResponse | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUserSummary[]>([]);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminSavedUserId, setAdminSavedUserId] = useState<string | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [learningProfileError, setLearningProfileError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isClearingData, setIsClearingData] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const questionsRef = useRef<HTMLElement | null>(null);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollToQuestionsRef = useRef(false);
  const availableReport = scoreResult ?? currentQuiz?.score_result ?? null;
  const trendData =
    insights?.history_trend.map((item) => ({
      ...item,
      label: formatChartDate(item.attempted_at),
      fullLabel: formatDate(item.attempted_at),
    })) ?? [];
  const difficultyData =
    insights?.difficulty_performance.map((item) => ({
      ...item,
      label: DIFFICULTY_LABELS[item.difficulty],
    })) ?? [];
  const questionTypeData =
    insights?.question_type_performance.map((item) => ({
      ...item,
      label: QUESTION_TYPE_LABELS[item.question_type] ?? item.question_type,
    })) ?? [];
  const learningProfileChartData =
    insights?.learning_profile_overview.map((item: LearningProfileOverviewItem) => ({
      ...item,
      label: item.domain,
    })) ?? [];

  function hydrateQuiz(quiz: QuizWorkflowResponse) {
    const persistedAnswers = normalizeSubmittedAnswers(quiz.submitted_answers);

    setSelectedQuizId(quiz.id);
    setCurrentQuiz(quiz);
    setContent(quiz.content);
    setPreference(quiz.preference);
    setDifficulty(quiz.difficulty);
    setNumbersInput(String(quiz.numbers));
    setEditingTitleId(null);
    setQuizPhase(quiz.score_result ? "review" : "answering");
    setUserAnswers(persistedAnswers);
    setScoreResult(quiz.score_result);
    setErrorMessage(null);
  }

  function resetComposer() {
    setSelectedQuizId(null);
    setCurrentQuiz(null);
    setContent("");
    setPreference(DEFAULT_PREFERENCE);
    setDifficulty("medium");
    setNumbersInput(DEFAULT_NUMBERS);
    setEditingTitleId(null);
    setTitleDraft("");
    setErrorMessage(null);
    setMenuOpen(false);
    setAccountMenuOpen(false);
    setKnowledgeModalOpen(false);
    setDownloadModalOpen(false);
    setDeleteTarget(null);
    setQuizPhase("answering");
    setUserAnswers({});
    setScoreResult(null);
    panelRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetWorkspaceState() {
    setHistory([]);
    setInsights(null);
    setInsightsError(null);
    setLearningProfile(null);
    setLearningProfileError(null);
    setMenuOpen(false);
    setAccountMenuOpen(false);
    setPersonalizeModalOpen(false);
    setKnowledgeModalOpen(false);
    setInsightsModalOpen(false);
    setDownloadModalOpen(false);
    setSettingsModalOpen(false);
    setClearDataConfirmOpen(false);
    resetComposer();
  }

  function handleSessionExpired(message = "Your session has expired. Please sign in again.") {
    setAuthStatus("unauthenticated");
    setCurrentUser(null);
    setAuthError(message);
    resetWorkspaceState();
  }

  async function loadWorkspace() {
    setIsLoadingHistory(true);
    setErrorMessage(null);

    try {
      const items = await fetchJson<QuizHistoryItem[]>("/quizzes");
      setHistory(items);

      if (items.length > 0) {
        const detail = await fetchJson<QuizWorkflowResponse>(`/quizzes/${items[0].id}`);
        hydrateQuiz(detail);
      } else {
        resetComposer();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load quiz history.";
      if (message === "Authentication required." || message === "Session expired.") {
        handleSessionExpired();
        return;
      }
      setErrorMessage(message);
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function handleGoogleAuthenticate(credential: string) {
    setIsAuthenticating(true);
    setAuthError(null);

    try {
      const user = await fetchJson<AuthUser>("/auth/google", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ credential }),
      });

      setCurrentUser(user);
      setAuthStatus("authenticated");
      await loadWorkspace();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to sign in with Google.");
    } finally {
      setIsAuthenticating(false);
    }
  }

  async function handleLogout() {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);

    try {
      await fetchJson<null>("/auth/logout", {
        method: "POST",
      });
    } catch {
      // A missing or expired backend session should still log the user out locally.
    } finally {
      window.google?.accounts.id.disableAutoSelect();
      setCurrentUser(null);
      setAuthStatus("unauthenticated");
      setAuthError(null);
      resetWorkspaceState();
      setIsLoggingOut(false);
    }
  }

  async function handleClearAllDataConfirmed() {
    if (isClearingData) {
      return;
    }

    setIsClearingData(true);

    try {
      await fetchJson<null>("/auth/me/data", {
        method: "DELETE",
      });
      resetComposer();
      setHistory([]);
      setInsights(null);
      setLearningProfile(null);
      setInsightsError(null);
      setSettingsModalOpen(false);
      setClearDataConfirmOpen(false);
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to clear your data.";
      if (message === "Authentication required." || message === "Session expired.") {
        handleSessionExpired();
        return;
      }
      setErrorMessage(message);
    } finally {
      setIsClearingData(false);
    }
  }

  useEffect(() => {
    void (async () => {
      setAuthStatus("loading");
      setAuthError(null);

      try {
        const user = await fetchJson<AuthUser>("/auth/me");
        setCurrentUser(user);
        setAuthStatus("authenticated");
        await loadWorkspace();
      } catch {
        setCurrentUser(null);
        setAuthStatus("unauthenticated");
        setIsLoadingHistory(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (authStatus !== "unauthenticated" || !googleButtonRef.current || !GOOGLE_CLIENT_ID) {
      return;
    }

    const googleIdentity = window.google?.accounts.id;
    if (!googleIdentity) {
      return;
    }

    googleButtonRef.current.innerHTML = "";
    googleIdentity.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => {
        if (response.credential) {
          void handleGoogleAuthenticate(response.credential);
        }
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    googleIdentity.renderButton(googleButtonRef.current, {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: authMode === "signup" ? "signup_with" : "signin_with",
      logo_alignment: "left",
      width: 320,
    });

    return () => {
      if (googleButtonRef.current) {
        googleButtonRef.current.innerHTML = "";
      }
    };
  }, [authMode, authStatus]);

  useEffect(() => {
    if (!adminModalOpen || !currentUser?.is_admin) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshAdminUsers(true);
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [adminModalOpen, currentUser?.is_admin]);

  async function handleSelectHistoryItem(quizId: string) {
    setSelectedQuizId(quizId);
    setEditingTitleId(null);
    setErrorMessage(null);

    try {
      const detail = await fetchJson<QuizWorkflowResponse>(`/quizzes/${quizId}`);
      hydrateQuiz(detail);
      setHistory((previous) => [toHistoryItem(detail), ...previous.filter((item) => item.id !== detail.id)]);
      setMenuOpen(false);
      setAccountMenuOpen(false);
      panelRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load the selected quiz.";
      if (message === "Authentication required." || message === "Session expired.") {
        handleSessionExpired();
        return;
      }
      setErrorMessage(message);
    }
  }

  function handleStartTitleEdit(item: QuizHistoryItem) {
    setEditingTitleId(item.id);
    setTitleDraft(item.title);
    setErrorMessage(null);
  }

  async function handleSaveTitle(quizId: string) {
    const normalizedTitle = titleDraft.trim();
    if (!normalizedTitle) {
      setErrorMessage("Title must not be empty.");
      return;
    }

    setIsSavingTitle(true);
    setErrorMessage(null);

    try {
      const updatedItem = await fetchJson<QuizHistoryItem>(`/quizzes/${quizId}/title`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: normalizedTitle }),
      });

      setHistory((previous) =>
        previous.map((item) => (item.id === quizId ? updatedItem : item)),
      );
      setCurrentQuiz((previous) =>
        previous && previous.id === quizId ? { ...previous, title: updatedItem.title } : previous,
      );
      setEditingTitleId(null);
      setTitleDraft("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update title.";
      if (message === "Authentication required." || message === "Session expired.") {
        handleSessionExpired();
        return;
      }
      setErrorMessage(message);
    } finally {
      setIsSavingTitle(false);
    }
  }

  async function handleDeleteQuizConfirmed() {
    if (!deleteTarget || isDeletingQuiz) {
      return;
    }

    setIsDeletingQuiz(true);

    try {
      await fetchJson<null>(`/quizzes/${deleteTarget.id}`, {
        method: "DELETE",
      });

      const nextHistory = history.filter((item) => item.id !== deleteTarget.id);
      setHistory(nextHistory);
      setInsights(null);
      setLearningProfile(null);
      setDeleteTarget(null);
      setMenuOpen(false);

      if (selectedQuizId === deleteTarget.id) {
        if (nextHistory[0]) {
          await handleSelectHistoryItem(nextHistory[0].id);
        } else {
          resetComposer();
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete quiz.";
      if (message === "Authentication required." || message === "Session expired.") {
        handleSessionExpired();
        return;
      }
      setErrorMessage(message);
    } finally {
      setIsDeletingQuiz(false);
    }
  }

  function handleOpenDownloadModal() {
    if (!currentQuiz) {
      return;
    }

    setDownloadTarget("quiz");
    setDownloadModalOpen(true);
  }

  async function handleOpenInsightsModal() {
    setMenuOpen(false);
    setAccountMenuOpen(false);
    setInsightsModalOpen(true);
    setInsightsError(null);

    if (insights || isLoadingInsights) {
      return;
    }

    setIsLoadingInsights(true);

    try {
      const response = await fetchJson<LearningInsightsResponse>("/insights");
      setInsights(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load insights.";
      if (message === "Authentication required." || message === "Session expired.") {
        handleSessionExpired();
        return;
      }
      setInsightsError(message);
    } finally {
      setIsLoadingInsights(false);
    }
  }

  async function refreshAdminUsers(background = false) {
    if (!currentUser?.is_admin) {
      return;
    }

    if (!background) {
      setIsLoadingAdminUsers(true);
    }
    setAdminError(null);

    try {
      const response = await fetchJson<AdminUserSummary[]>("/admin/users");
      setAdminUsers(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load admin users.";
      if (message === "Authentication required." || message === "Session expired.") {
        handleSessionExpired();
        return;
      }
      setAdminError(message);
    } finally {
      if (!background) {
        setIsLoadingAdminUsers(false);
      }
    }
  }

  async function handleOpenAdminModal() {
    setAccountMenuOpen(false);
    setAdminModalOpen(true);

    if (!currentUser?.is_admin || isLoadingAdminUsers) {
      return;
    }

    await refreshAdminUsers();
  }

  async function handleOpenPersonalizeModal() {
    setAccountMenuOpen(false);
    setPersonalizeModalOpen(true);
    setLearningProfileError(null);

    if (learningProfile || isLoadingLearningProfile) {
      return;
    }

    setIsLoadingLearningProfile(true);
    try {
      const response = await fetchJson<LearningProfileResponse>("/learning-profile");
      setLearningProfile(response);
      if (currentUser) {
        setCurrentUser({ ...currentUser, learning_profile_enabled: response.enabled });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load learning profile.";
      if (message === "Authentication required." || message === "Session expired.") {
        handleSessionExpired();
        return;
      }
      setLearningProfileError(message);
    } finally {
      setIsLoadingLearningProfile(false);
    }
  }

  async function handleToggleLearningProfile(enabled: boolean) {
    setIsSavingLearningProfileSettings(true);
    setLearningProfileError(null);

    try {
      const response = await fetchJson<LearningProfileResponse>("/learning-profile/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled }),
      });
      setLearningProfile(response);
      setInsights(null);
      if (currentUser) {
        setCurrentUser({ ...currentUser, learning_profile_enabled: response.enabled });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update learning profile settings.";
      if (message === "Authentication required." || message === "Session expired.") {
        handleSessionExpired();
        return;
      }
      setLearningProfileError(message);
    } finally {
      setIsSavingLearningProfileSettings(false);
    }
  }

  async function handleDeleteLearningProfileEntry(domain: string) {
    setDeletingLearningProfileDomain(domain);
    setLearningProfileError(null);

    try {
      const response = await fetchJson<LearningProfileResponse>(
        `/learning-profile/entries/${encodeURIComponent(domain)}`,
        {
          method: "DELETE",
        },
      );
      setLearningProfile(response);
      setInsights(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete the learning profile entry.";
      if (message === "Authentication required." || message === "Session expired.") {
        handleSessionExpired();
        return;
      }
      setLearningProfileError(message);
    } finally {
      setDeletingLearningProfileDomain(null);
    }
  }

  async function handleSaveAdminAccess(
    user: AdminUserSummary,
    changes: Partial<Pick<AdminUserSummary, "is_admin" | "daily_quiz_limit" | "daily_retake_limit">>,
  ) {
    const payload = {
      is_admin: changes.is_admin ?? user.is_admin,
      daily_quiz_limit: changes.daily_quiz_limit ?? user.daily_quiz_limit,
      daily_retake_limit: changes.daily_retake_limit ?? user.daily_retake_limit,
    };

    setIsSavingAdminAccess(user.id);
    setAdminError(null);

    try {
      const updatedUser = await fetchJson<AdminUserSummary>(`/admin/users/${user.id}/access`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      setAdminUsers((previous) => previous.map((item) => (item.id === user.id ? updatedUser : item)));
      if (currentUser && currentUser.id === user.id) {
        setCurrentUser({
          ...currentUser,
          is_admin: updatedUser.is_admin,
          daily_quiz_limit: updatedUser.daily_quiz_limit,
          daily_retake_limit: updatedUser.daily_retake_limit,
        });
      }
      setAdminSavedUserId(user.id);
      window.setTimeout(() => {
        setAdminSavedUserId((current) => (current === user.id ? null : current));
      }, 1800);
      void refreshAdminUsers(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update user access.";
      if (message === "Authentication required." || message === "Session expired.") {
        handleSessionExpired();
        return;
      }
      setAdminError(message);
    } finally {
      setIsSavingAdminAccess(null);
    }
  }

  function handleSingleAnswer(questionIndex: number, value: string) {
    setUserAnswers((previous) => ({
      ...previous,
      [questionIndex]: value,
    }));
  }

  function handleToggleMultiAnswer(questionIndex: number, value: string) {
    setUserAnswers((previous) => {
      const current = previous[questionIndex];
      const nextValues = new Set(Array.isArray(current) ? current : []);

      if (nextValues.has(value)) {
        nextValues.delete(value);
      } else {
        nextValues.add(value);
      }

      return {
        ...previous,
        [questionIndex]: Array.from(nextValues).sort(),
      };
    });
  }

  function handleTextAnswer(questionIndex: number, value: string) {
    setUserAnswers((previous) => ({
      ...previous,
      [questionIndex]: value,
    }));
  }

  async function handleQuizSubmit() {
    if (!currentQuiz || isScoringQuiz) {
      return;
    }

    setIsScoringQuiz(true);
    setErrorMessage(null);

    try {
      const answers = Object.entries(userAnswers).map(([questionIndex, answer]) => ({
        question_index: Number(questionIndex),
        answer,
      }));
      const submittedAnswers = answers.reduce<Record<string, UserAnswer>>((accumulator, item) => {
        accumulator[String(item.question_index)] = item.answer;
        return accumulator;
      }, {});

      const result = await fetchJson<QuizScoreResponse>(`/quizzes/${currentQuiz.id}/score`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ answers }),
      });

      setScoreResult(result);
      setInsights(null);
      setLearningProfile(null);
      setQuizPhase("review");
      setCurrentQuiz((previous) =>
        previous && previous.id === currentQuiz.id
          ? { ...previous, submitted_answers: submittedAnswers, score_result: result }
          : previous,
      );
      requestAnimationFrame(() => {
        panelRef.current?.scrollTo({
          top: panelRef.current.scrollHeight,
          behavior: "smooth",
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Quiz scoring failed.";
      if (message === "Authentication required." || message === "Session expired.") {
        handleSessionExpired();
        return;
      }
      setErrorMessage(message);
    } finally {
      setIsScoringQuiz(false);
    }
  }

  async function handleDownloadConfirmed() {
    if (!currentQuiz || isDownloadingDocument) {
      return;
    }

    setIsDownloadingDocument(true);

    try {
      await downloadQuizPdf({
        quiz: currentQuiz,
        scoreResult: availableReport,
        answers:
          Object.keys(userAnswers).length > 0
            ? userAnswers
            : normalizeSubmittedAnswers(currentQuiz.submitted_answers),
        documentType: downloadTarget,
      });
      setDownloadModalOpen(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to export PDF.");
    } finally {
      setIsDownloadingDocument(false);
    }
  }

  async function handleRetake() {
    if (!currentQuiz) {
      return;
    }

    try {
      await fetchJson<DailyQuotaStatus>(`/quizzes/${currentQuiz.id}/retake`, {
        method: "POST",
      });
      setQuizPhase("answering");
      setUserAnswers({});
      setScoreResult(null);
      requestAnimationFrame(() => {
        if (!panelRef.current || !questionsRef.current) {
          return;
        }

        panelRef.current.scrollTo({
          top: Math.max(questionsRef.current.offsetTop - 88, 0),
          behavior: "smooth",
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start a retake.";
      if (message === "Authentication required." || message === "Session expired.") {
        handleSessionExpired();
        return;
      }
      setErrorMessage(message);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitDisabled) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    panelRef.current?.scrollTo({ top: 0, behavior: "smooth" });

    try {
      const payload = {
        content: content.trim(),
        preference: preference.trim(),
        difficulty,
        numbers: Number(numbersInput),
      };

      const isUpdatingExistingQuiz = Boolean(selectedQuizId && currentQuiz);
      const path = isUpdatingExistingQuiz ? `/quizzes/${selectedQuizId}/run` : "/quiz/run";
      const method = isUpdatingExistingQuiz ? "PUT" : "POST";

      const quiz = await fetchJson<QuizWorkflowResponse>(path, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      hydrateQuiz(quiz);
      setQuizPhase("answering");
      setUserAnswers({});
      setScoreResult(null);
      setInsights(null);
      setLearningProfile(null);
      shouldScrollToQuestionsRef.current = true;
      setHistory((previous) => [toHistoryItem(quiz), ...previous.filter((item) => item.id !== quiz.id)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Quiz generation failed.";
      if (message === "Authentication required." || message === "Session expired.") {
        handleSessionExpired();
        return;
      }
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const normalizedContentLength = content.length;
  const contentExceeded = normalizedContentLength > MAX_CONTENT_LENGTH;
  const numberValue = Number(numbersInput);
  const invalidQuestionCount =
    !Number.isInteger(numberValue) || numberValue < 1 || numberValue > MAX_QUESTION_COUNT;
  const isSubmitDisabled =
    isSubmitting || !content.trim() || contentExceeded || invalidQuestionCount;

  useEffect(() => {
    if (!currentQuiz || !shouldScrollToQuestionsRef.current) {
      return;
    }

    shouldScrollToQuestionsRef.current = false;

    requestAnimationFrame(() => {
      if (!panelRef.current || !questionsRef.current) {
        return;
      }

      panelRef.current.scrollTo({
        top: Math.max(questionsRef.current.offsetTop - 88, 0),
        behavior: "smooth",
      });
    });
  }, [currentQuiz]);

  if (authStatus === "loading") {
    return (
      <div className="app-loader">
        <div className="app-loader__panel">
          <span className="workspace__wordmark">Fastlearn</span>
          <div className="auth-card__status">
            <Spinner />
            <span>Restoring your workspace...</span>
          </div>
        </div>
      </div>
    );
  }

  if (authStatus === "unauthenticated") {
    return (
      <AuthScreen
        mode={authMode}
        authError={authError}
        isAuthenticating={isAuthenticating}
        onModeChange={setAuthMode}
        googleButtonRef={googleButtonRef}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "" : "is-collapsed"}`}>
        <div className="sidebar__top">
          <div className="sidebar__brand">
            <button
              type="button"
              className="sidebar__toggle"
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 6.5h16M4 12h16M4 17.5h16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
            {sidebarOpen && <span className="sidebar__logo">Fastlearn</span>}
          </div>

          <button type="button" className="sidebar__new" onClick={resetComposer}>
            <span className="sidebar__new-icon">+</span>
            {sidebarOpen && <span>New</span>}
          </button>
        </div>

        <div className="sidebar__history">
          {sidebarOpen && <p className="sidebar__label">Past Quizzes</p>}

          {isLoadingHistory ? (
            <div className="sidebar__empty">
              <Spinner />
              {sidebarOpen && <span>Loading history...</span>}
            </div>
          ) : history.length === 0 ? (
            <div className="sidebar__empty">
              <span className="sidebar__empty-dot" />
              {sidebarOpen && <span>No saved quizzes yet.</span>}
            </div>
          ) : (
            <div className="sidebar__list">
              {history.map((item) => (
                <div
                  key={item.id}
                  className={`sidebar__item ${selectedQuizId === item.id ? "is-active" : ""}`}
                >
                  {editingTitleId === item.id && sidebarOpen ? (
                    <>
                      <span className="sidebar__item-mark" />
                      <div className="sidebar__item-copy sidebar__item-copy--editing">
                        <input
                          className="sidebar__item-title-input"
                          value={titleDraft}
                          maxLength={MAX_TITLE_LENGTH}
                          onChange={(event) => setTitleDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void handleSaveTitle(item.id);
                            }
                            if (event.key === "Escape") {
                              setEditingTitleId(null);
                              setTitleDraft("");
                            }
                          }}
                          autoFocus
                        />
                        <span className="sidebar__item-meta">
                          {titleDraft.length}/{MAX_TITLE_LENGTH}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="sidebar__item-edit"
                        disabled={isSavingTitle}
                        onClick={() => void handleSaveTitle(item.id)}
                      >
                        {isSavingTitle ? "..." : "✓"}
                      </button>
                      <button
                        type="button"
                        className="sidebar__item-edit sidebar__item-edit--ghost"
                        onClick={() => {
                          setEditingTitleId(null);
                          setTitleDraft("");
                        }}
                      >
                        ✕
                      </button>
                      <button
                        type="button"
                        className="sidebar__item-edit sidebar__item-edit--danger"
                        onClick={() => setDeleteTarget({ id: item.id, title: item.title })}
                        aria-label={`Delete ${item.title}`}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M9 3.75h6l.75 1.5H20v1.5H4v-1.5h4.25L9 3.75Zm-1.5 6h1.5v7.5H7.5v-7.5Zm4.5 0h1.5v7.5H12v-7.5Zm4.5 0H18v7.5h-1.5v-7.5ZM6.75 8.25h10.5v10.5a1.5 1.5 0 0 1-1.5 1.5h-7.5a1.5 1.5 0 0 1-1.5-1.5V8.25Z"
                            fill="currentColor"
                          />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="sidebar__item-select"
                        onClick={() => void handleSelectHistoryItem(item.id)}
                        aria-label={item.title}
                      >
                        <span className="sidebar__item-mark" />
                        {sidebarOpen && (
                          <span className="sidebar__item-copy">
                            <span className="sidebar__item-title">{item.title}</span>
                            <span className="sidebar__item-meta">
                              {formatDate(item.updated_at)} · {formatQuestionCount(item.numbers)}
                            </span>
                          </span>
                        )}
                      </button>
                      {sidebarOpen && (
                        <button
                          type="button"
                          className="sidebar__item-edit"
                          onClick={() => handleStartTitleEdit(item)}
                          aria-label={`Edit ${item.title}`}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              d="M15.672 3.462a2.25 2.25 0 0 1 3.182 0l1.684 1.684a2.25 2.25 0 0 1 0 3.182l-9.91 9.91a4.5 4.5 0 0 1-1.897 1.118l-3.03.866a.75.75 0 0 1-.928-.928l.866-3.03a4.5 4.5 0 0 1 1.118-1.897l9.91-9.91Zm1.06 1.06-9.91 9.91a3 3 0 0 0-.746 1.264l-.55 1.922 1.922-.55a3 3 0 0 0 1.264-.746l9.91-9.91a.75.75 0 0 0 0-1.06l-1.684-1.684a.75.75 0 0 0-1.06 0Z"
                              fill="currentColor"
                            />
                          </svg>
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {currentUser && (
          <div className="sidebar__footer">
            <div className="menu-anchor menu-anchor--account">
              {accountMenuOpen && (
                <div className="account-menu">
                  <div className="account-menu__identity">
                    <UserAvatar user={currentUser} className="account-menu__avatar" />
                    <div>
                      <strong>{currentUser.name}</strong>
                      <span>{currentUser.email}</span>
                    </div>
                  </div>

                  <div className="account-menu__actions">
                    {currentUser.is_admin && (
                      <button
                        type="button"
                        onClick={() => void handleOpenAdminModal()}
                      >
                        Admin Console
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                      }}
                    >
                      Upgrade Plan
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleOpenPersonalizeModal()}
                    >
                      Personalize
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        setSettingsModalOpen(true);
                      }}
                    >
                      Settings
                    </button>
                    <button
                      type="button"
                      disabled={isLoggingOut}
                      onClick={() => void handleLogout()}
                    >
                      {isLoggingOut ? "Logging out..." : "Logout"}
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                className={`sidebar-account ${accountMenuOpen ? "is-open" : ""}`}
                onClick={() => {
                  setMenuOpen(false);
                  setAccountMenuOpen((open) => !open);
                }}
                aria-expanded={accountMenuOpen}
              >
                <UserAvatar user={currentUser} className="sidebar-account__avatar" />
                {sidebarOpen && (
                  <span className="sidebar-account__copy">
                    <strong>{currentUser.name}</strong>
                    <span>{currentUser.email}</span>
                  </span>
                )}
              </button>
            </div>
          </div>
        )}
      </aside>

      <main className="workspace">
        <div className="workspace__panel" ref={panelRef}>
          <header className="workspace__header">
            <div className="workspace__header-left">
              <div className="workspace__wordmark">Fastlearn</div>
              <label className="model-select">
                <span className="sr-only">Choose model</span>
                <select defaultValue="fastlearn-v1">
                  <option value="fastlearn-v1">Fastlearn-v1</option>
                </select>
              </label>
            </div>

            <div className="workspace__header-actions">
              <button
                type="button"
                className="ghost-button ghost-button--download"
                onClick={handleOpenDownloadModal}
                disabled={!currentQuiz}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M12 3.75v9m0 0 3-3m-3 3-3-3M4.75 15.75v2a1.5 1.5 0 0 0 1.5 1.5h11.5a1.5 1.5 0 0 0 1.5-1.5v-2"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.85"
                  />
                </svg>
                <span>Download</span>
              </button>

              <div className="menu-anchor">
                <button
                  type="button"
                  className="ghost-button ghost-button--icon"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    setMenuOpen((open) => !open);
                  }}
                  aria-expanded={menuOpen}
                  aria-label="Open more options"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="5" cy="12" r="1.8" fill="currentColor" />
                    <circle cx="12" cy="12" r="1.8" fill="currentColor" />
                    <circle cx="19" cy="12" r="1.8" fill="currentColor" />
                  </svg>
                </button>

                {menuOpen && (
                  <div className="menu-panel">
                    <button type="button" onClick={() => void handleOpenInsightsModal()}>
                      Insights
                    </button>
                    <button
                      type="button"
                      className="menu-panel__danger"
                      disabled={!currentQuiz}
                      onClick={() => {
                        if (currentQuiz) {
                          setDeleteTarget({ id: currentQuiz.id, title: currentQuiz.title });
                          setMenuOpen(false);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          <section className="composer">
            <form className="composer__form" onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="content-input">Learning Notes</label>
                <textarea
                  id="content-input"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="Paste your study scope, notes, or condensed learning material..."
                  rows={10}
                />
                <div className="field__meta">
                  <span className={contentExceeded ? "field__warning" : ""}>
                    {normalizedContentLength}/{MAX_CONTENT_LENGTH}
                  </span>
                </div>
                {contentExceeded && (
                  <p className="field__error">Content must be 10000 characters or fewer.</p>
                )}
              </div>

              <div className="field">
                <label htmlFor="preference-input">Preference</label>
                <input
                  id="preference-input"
                  type="text"
                  value={preference}
                  maxLength={500}
                  onChange={(event) => setPreference(event.target.value)}
                  placeholder="Add a preference, such as concept-focused or slightly tricky questions..."
                />
                <div className="field__meta">
                  <span>{preference.length}/500</span>
                </div>
              </div>

                <div className="composer__controls">
                <div className="field field--compact">
                  <label htmlFor="difficulty-select">Difficulty</label>
                  <select
                    id="difficulty-select"
                    value={difficulty}
                    onChange={(event) => setDifficulty(event.target.value as DifficultyLevel)}
                  >
                    {DIFFICULTY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field field--compact">
                  <label htmlFor="number-input">Question Count</label>
                  <input
                    id="number-input"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_QUESTION_COUNT}
                    step={1}
                    value={numbersInput}
                    onChange={(event) => setNumbersInput(event.target.value)}
                  />
                  {invalidQuestionCount && (
                    <p className="field__error">Enter a whole number between 1 and 25.</p>
                  )}
                </div>

                <div className="field field--compact field--action">
                  <label htmlFor="submit-button" className="field__placeholder-label">
                    Generate
                  </label>
                  <button
                    id="submit-button"
                    type="submit"
                    className="submit-button"
                    disabled={isSubmitDisabled}
                  >
                    {isSubmitting ? (
                      <>
                        <Spinner />
                        <span>Generating...</span>
                      </>
                    ) : (
                      <span>Generate</span>
                    )}
                  </button>
                </div>
              </div>
            </form>

            {errorMessage && <div className="alert-banner">{errorMessage}</div>}
          </section>

          <div className="workspace__divider" aria-hidden="true">
            <span className="workspace__divider-line" />
            <span className="workspace__divider-orb" />
            <span className="workspace__divider-line" />
          </div>

          {currentQuiz ? (
            <section className="results">
              <div className="results__meta">
                <div>
                  <p className="results__eyebrow">Latest Output</p>
                  <h1>{currentQuiz.title}</h1>
                </div>
                <div className="results__chips">
                  <span>{formatDate(currentQuiz.updated_at)}</span>
                  <span>{DIFFICULTY_LABELS[currentQuiz.difficulty]}</span>
                  <span>{formatQuestionCount(currentQuiz.numbers)}</span>
                </div>
              </div>

              {scoreResult && (
                <div className="results__score-banner">
                  <div>
                    <p className="results__score-label">Latest Score</p>
                    <div className="results__score-value">
                      {formatScoreValue(scoreResult.total_score)}
                      <span>/ {formatScoreValue(scoreResult.max_score)}</span>
                    </div>
                  </div>
                  <p className="results__score-note">Saved from your latest submitted attempt.</p>
                </div>
              )}

              <button
                type="button"
                className="summary-card summary-card--trigger"
                onClick={() => setKnowledgeModalOpen(true)}
              >
                <span className="summary-card__main">
                  <span>Knowledge Points</span>
                  <span className="summary-card__subcopy">Open the knowledge map in a focused view.</span>
                </span>
                <span className="summary-card__side">
                  <span className="summary-card__hint">
                    {Object.keys(currentQuiz.summary.points).length} items
                  </span>
                  <span className="summary-card__cta">View</span>
                </span>
              </button>

              <section className="question-stack" ref={questionsRef}>
                <div className="section-heading">
                  <p className="results__eyebrow">Generated Questions</p>
                  <h2>{currentQuiz.questions.length} Questions</h2>
                </div>
                {currentQuiz.questions.map((question, index) => (
                  <QuestionCard
                    key={`${question.stem}-${index}`}
                    question={question}
                    index={index}
                    phase={quizPhase}
                    userAnswer={userAnswers[index]}
                    scoreResult={scoreResult?.results.find((item) => item.question_index === index)}
                    onSingleAnswer={(value) => handleSingleAnswer(index, value)}
                    onToggleMultiAnswer={(value) => handleToggleMultiAnswer(index, value)}
                    onTextAnswer={(value) => handleTextAnswer(index, value)}
                  />
                ))}
                <div className="question-stack__footer">
                  {quizPhase === "answering" ? (
                    <button
                      type="button"
                      className="submit-button"
                      onClick={() => void handleQuizSubmit()}
                      disabled={isScoringQuiz}
                    >
                      {isScoringQuiz ? (
                        <>
                          <Spinner />
                          <span>Scoring...</span>
                        </>
                      ) : (
                        <span>Submit</span>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ghost-button ghost-button--retake"
                      onClick={handleRetake}
                    >
                      Retake
                    </button>
                  )}
                </div>
              </section>
            </section>
          ) : (
            <section className="empty-state">
              <div className="empty-state__panel">
                <p className="results__eyebrow">Ready</p>
                <h1>Paste your notes and generate the next quiz set.</h1>
                <p>
                  Fill in your notes, preference, difficulty, and question count. Every successful run
                  is saved in the left history list.
                </p>
              </div>
            </section>
          )}
        </div>

        {insightsModalOpen && (
          <div
            className="modal-backdrop"
            role="presentation"
            onClick={() => setInsightsModalOpen(false)}
          >
            <div
              className="modal-panel modal-panel--insights"
              role="dialog"
              aria-modal="true"
              aria-labelledby="insights-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-panel__header">
                <div>
                  <p className="results__eyebrow">Insights</p>
                  <h2 id="insights-modal-title">Learning Analytics</h2>
                </div>
                <button
                  type="button"
                  className="modal-panel__close"
                  onClick={() => setInsightsModalOpen(false)}
                  aria-label="Close insights modal"
                >
                  ✕
                </button>
              </div>

              <div className="modal-panel__body">
                {isLoadingInsights ? (
                  <div className="insights-empty">
                    <Spinner />
                    <span>Loading analytics...</span>
                  </div>
                ) : insightsError ? (
                  <div className="insights-empty insights-empty--error">{insightsError}</div>
                ) : insights ? (
                  <div className="insights-grid">
                    <InsightCard
                      title="Historical Score Trend"
                      subtitle="Line chart with a rolling 7-attempt moving average."
                    >
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={trendData}>
                          <CartesianGrid stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
                          <XAxis dataKey="label" tickLine={false} axisLine={false} />
                          <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
                          <Tooltip
                            formatter={(value: number | string) => `${formatNumericMetric(value)} pts`}
                            labelFormatter={(label: string | number) => String(label)}
                          />
                          <Legend />
                          <Line type="monotone" dataKey="total_score" stroke="#2563eb" strokeWidth={3} dot={{ r: 3 }} name="Score" />
                          <Line type="monotone" dataKey="moving_average" stroke="#14b8a6" strokeWidth={2.5} dot={false} name="7-Attempt Average" />
                        </LineChart>
                      </ResponsiveContainer>
                    </InsightCard>

                    <InsightCard
                      title="Difficulty Performance"
                      subtitle="Average score based on currently saved quizzes."
                    >
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={difficultyData}>
                          <CartesianGrid stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
                          <XAxis dataKey="label" tickLine={false} axisLine={false} />
                          <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
                          <Tooltip formatter={(value: number | string) => `${formatNumericMetric(value)} pts`} />
                          <Bar dataKey="average_score" radius={[12, 12, 0, 0]} fill="#1d4ed8" />
                        </BarChart>
                      </ResponsiveContainer>
                    </InsightCard>

                    <InsightCard
                      title="Question-Type Ability"
                      subtitle="Capability across question types based on current saved quizzes."
                      actions={(
                        <div className="segmented-control">
                          <button
                            type="button"
                            className={abilityChartMode === "radar" ? "is-active" : ""}
                            onClick={() => setAbilityChartMode("radar")}
                          >
                            Radar
                          </button>
                          <button
                            type="button"
                            className={abilityChartMode === "bars" ? "is-active" : ""}
                            onClick={() => setAbilityChartMode("bars")}
                          >
                            Bars
                          </button>
                        </div>
                      )}
                    >
                      <ResponsiveContainer width="100%" height={320}>
                        {abilityChartMode === "radar" ? (
                          <RadarChart data={questionTypeData}>
                            <PolarGrid />
                            <PolarAngleAxis dataKey="label" tick={{ fontSize: 12 }} />
                            <PolarRadiusAxis domain={[0, 100]} />
                            <Radar dataKey="ability_score" stroke="#2563eb" fill="#60a5fa" fillOpacity={0.4} />
                            <Tooltip formatter={(value: number | string) => `${formatNumericMetric(value)}%`} />
                          </RadarChart>
                        ) : (
                          <BarChart data={questionTypeData} layout="vertical" margin={{ left: 20 }}>
                            <CartesianGrid stroke="rgba(148, 163, 184, 0.2)" horizontal={false} />
                            <XAxis type="number" domain={[0, 100]} tickLine={false} axisLine={false} />
                            <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={108} />
                            <Tooltip formatter={(value: number | string) => `${formatNumericMetric(value)}%`} />
                            <Bar dataKey="ability_score" radius={[0, 12, 12, 0]} fill="#2563eb" />
                          </BarChart>
                        )}
                      </ResponsiveContainer>
                    </InsightCard>

                    <InsightCard
                      title="Error-Type Distribution"
                      subtitle={`Sampled from the latest ${insights.sampled_attempt_count} submitted quizzes.`}
                    >
                      <ResponsiveContainer width="100%" height={320}>
                        <PieChart>
                          <Pie
                            data={insights.error_type_breakdown}
                            dataKey="count"
                            nameKey="error_type"
                            innerRadius={72}
                            outerRadius={108}
                            paddingAngle={2}
                          >
                            {insights.error_type_breakdown.map((entry, index) => (
                              <Cell key={entry.error_type} fill={ERROR_COLORS[index % ERROR_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value: number | string) => `${formatNumericMetric(value)}`} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </InsightCard>

                    <InsightCard
                      title="Learning Domain Mastery"
                      subtitle="Current domain-level mastery grades across your tracked study areas."
                    >
                      <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={learningProfileChartData} layout="vertical" margin={{ left: 24, right: 12 }}>
                          <CartesianGrid stroke="rgba(148, 163, 184, 0.2)" horizontal={false} />
                          <XAxis type="number" domain={[0, 100]} tickLine={false} axisLine={false} />
                          <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={150} />
                          <Tooltip
                            formatter={(value: number | string, _, payload) => {
                              const entry = payload?.payload as LearningProfileOverviewItem | undefined;
                              return [`${formatNumericMetric(value)} pts`, entry?.grade ? `Grade ${entry.grade}` : "Grade"];
                            }}
                          />
                          <Bar dataKey="grade_score" radius={[0, 12, 12, 0]} fill="#0f766e" />
                        </BarChart>
                      </ResponsiveContainer>
                    </InsightCard>
                  </div>
                ) : (
                  <div className="insights-empty">No submitted attempts yet.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {knowledgeModalOpen && currentQuiz && (
          <div
            className="modal-backdrop"
            role="presentation"
            onClick={() => setKnowledgeModalOpen(false)}
          >
            <div
              className="modal-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="knowledge-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-panel__header">
                <div>
                  <p className="results__eyebrow">Knowledge Points</p>
                  <h2 id="knowledge-modal-title">Focused Knowledge Map</h2>
                </div>
                <button
                  type="button"
                  className="modal-panel__close"
                  onClick={() => setKnowledgeModalOpen(false)}
                  aria-label="Close knowledge points modal"
                >
                  ✕
                </button>
              </div>

              <div className="modal-panel__body">
                {Object.entries(currentQuiz.summary.points).map(([key, value]) => (
                  <article key={key} className="modal-knowledge-card">
                    <h3>{key}</h3>
                    <p>{value}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        )}

        {downloadModalOpen && currentQuiz && (
          <div
            className="modal-backdrop"
            role="presentation"
            onClick={() => setDownloadModalOpen(false)}
          >
            <div
              className="confirm-panel download-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="download-quiz-title"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="results__eyebrow">Download PDF</p>
              <h2 id="download-quiz-title">Export "{currentQuiz.title}"</h2>
              <p>Choose the PDF format you want to export for the current quiz.</p>

              <div className="download-options">
                <button
                  type="button"
                  className={`download-option ${downloadTarget === "quiz" ? "is-active" : ""}`}
                  onClick={() => setDownloadTarget("quiz")}
                >
                  <span className="download-option__title">Question PDF</span>
                  <span className="download-option__copy">
                    Includes the quiz title, metadata, questions, options, and answer key.
                  </span>
                </button>

                <button
                  type="button"
                  className={`download-option ${downloadTarget === "report" ? "is-active" : ""}`}
                  onClick={() => availableReport && setDownloadTarget("report")}
                  disabled={!availableReport}
                >
                  <span className="download-option__title">Report PDF</span>
                  <span className="download-option__copy">
                    Includes answers, per-question scores, and saved feedback from the latest attempt.
                  </span>
                  {!availableReport && (
                    <span className="download-option__hint">Submit this quiz first to unlock the report.</span>
                  )}
                </button>
              </div>

              <div className="confirm-panel__actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setDownloadModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="submit-button"
                  disabled={isDownloadingDocument}
                  onClick={() => void handleDownloadConfirmed()}
                >
                  {isDownloadingDocument ? "Preparing..." : "Download PDF"}
                </button>
              </div>
            </div>
          </div>
        )}

        {personalizeModalOpen && currentUser && (
          <div
            className="modal-backdrop"
            role="presentation"
            onClick={() => setPersonalizeModalOpen(false)}
          >
            <div
              className="modal-panel modal-panel--settings"
              role="dialog"
              aria-modal="true"
              aria-labelledby="personalize-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-panel__header">
                <div>
                  <p className="results__eyebrow">Mastery Profile</p>
                  <h2 id="personalize-modal-title">Learning Domain Profile</h2>
                </div>
                <button
                  type="button"
                  className="modal-panel__close"
                  onClick={() => setPersonalizeModalOpen(false)}
                  aria-label="Close learning profile modal"
                >
                  ✕
                </button>
              </div>

              <div className="modal-panel__body modal-panel__body--settings">
                <section className="settings-card">
                  <div className="settings-card__identity settings-card__identity--split">
                    <div>
                      <h3>Automatic mastery updates</h3>
                      <p>
                        When enabled, each submitted quiz updates your domain-level mastery profile with
                        a fresh status summary and letter grade.
                      </p>
                    </div>
                    <label className="profile-toggle">
                      <input
                        type="checkbox"
                        checked={learningProfile?.enabled ?? currentUser.learning_profile_enabled}
                        disabled={isSavingLearningProfileSettings}
                        onChange={(event) => void handleToggleLearningProfile(event.target.checked)}
                      />
                      <span className="profile-toggle__track" aria-hidden="true">
                        <span className="profile-toggle__thumb" />
                      </span>
                      <span className="profile-toggle__label">
                        {(learningProfile?.enabled ?? currentUser.learning_profile_enabled) ? "On" : "Off"}
                      </span>
                    </label>
                  </div>
                </section>

                {isLoadingLearningProfile ? (
                  <div className="insights-empty">
                    <Spinner />
                    <span>Loading learning profile...</span>
                  </div>
                ) : learningProfileError ? (
                  <div className="insights-empty insights-empty--error">{learningProfileError}</div>
                ) : learningProfile && learningProfile.entries.length > 0 ? (
                  <div className="learning-profile-grid">
                    {learningProfile.entries.map((entry) => (
                      <article key={entry.domain} className="learning-profile-card">
                        <div className="learning-profile-card__head">
                          <div>
                            <h3>{entry.domain}</h3>
                            <p>{entry.status}</p>
                          </div>
                          <span className="learning-profile-card__grade">{entry.grade}</span>
                        </div>
                        <div className="learning-profile-card__footer">
                          <span>Domain mastery snapshot</span>
                          <button
                            type="button"
                            className="ghost-button"
                            disabled={deletingLearningProfileDomain === entry.domain}
                            onClick={() => void handleDeleteLearningProfileEntry(entry.domain)}
                          >
                            {deletingLearningProfileDomain === entry.domain ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="insights-empty">
                    No learning-domain records yet. Submit a quiz to start building your mastery profile.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {adminModalOpen && currentUser?.is_admin && (
          <div
            className="modal-backdrop"
            role="presentation"
            onClick={() => setAdminModalOpen(false)}
          >
            <div
              className="modal-panel modal-panel--insights modal-panel--admin"
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-panel__header">
                <div>
                  <p className="results__eyebrow">Admin Console</p>
                  <h2 id="admin-modal-title">User Access Control</h2>
                </div>
                <button
                  type="button"
                  className="modal-panel__close"
                  onClick={() => setAdminModalOpen(false)}
                  aria-label="Close admin modal"
                >
                  ✕
                </button>
              </div>

              <div className="modal-panel__body">
                {isLoadingAdminUsers ? (
                  <div className="insights-empty">
                    <Spinner />
                    <span>Loading all users...</span>
                  </div>
                ) : adminError ? (
                  <div className="insights-empty insights-empty--error">{adminError}</div>
                ) : (
                  <div className="admin-grid">
                    {adminUsers.map((user) => (
                      <article key={user.id} className="admin-user-card">
                        <div className="admin-user-card__head">
                          <div>
                            <h3>{user.name}</h3>
                            <p>{user.email}</p>
                          </div>
                          <div className="results__chips">
                            <span>{user.is_admin ? "Admin" : "User"}</span>
                            <span>{user.plan}</span>
                          </div>
                        </div>

                        <div className="admin-user-card__metrics">
                          <div>
                            <span>Today Quiz Runs</span>
                            <strong>
                              {user.quizzes_generated_today} / {user.daily_quiz_limit}
                            </strong>
                          </div>
                          <div>
                            <span>Today Retakes</span>
                            <strong>
                              {user.retakes_today} / {user.daily_retake_limit}
                            </strong>
                          </div>
                          <div>
                            <span>Total Quizzes</span>
                            <strong>{user.total_quizzes}</strong>
                          </div>
                          <div>
                            <span>Total Attempts</span>
                            <strong>{user.total_attempts}</strong>
                          </div>
                        </div>

                        <div className="admin-user-card__controls">
                          <label className="field field--compact">
                            <span>Quiz Limit / Day</span>
                            <input
                              type="number"
                              min={0}
                              value={user.daily_quiz_limit}
                              onChange={(event) => {
                                const nextValue = Math.max(0, Number(event.target.value || 0));
                                setAdminUsers((previous) =>
                                  previous.map((item) =>
                                    item.id === user.id ? { ...item, daily_quiz_limit: nextValue } : item,
                                  ),
                                );
                              }}
                            />
                          </label>

                          <label className="field field--compact">
                            <span>Retake Limit / Day</span>
                            <input
                              type="number"
                              min={0}
                              value={user.daily_retake_limit}
                              onChange={(event) => {
                                const nextValue = Math.max(0, Number(event.target.value || 0));
                                setAdminUsers((previous) =>
                                  previous.map((item) =>
                                    item.id === user.id ? { ...item, daily_retake_limit: nextValue } : item,
                                  ),
                                );
                              }}
                            />
                          </label>
                        </div>

                        <div className="admin-user-card__footer">
                          <label className="admin-toggle">
                            <input
                              type="checkbox"
                              checked={user.is_admin}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setAdminUsers((previous) =>
                                  previous.map((item) =>
                                    item.id === user.id ? { ...item, is_admin: checked } : item,
                                  ),
                                );
                              }}
                            />
                            <span>Admin access</span>
                          </label>
                          <button
                            type="button"
                            className={`submit-button ${adminSavedUserId === user.id ? "submit-button--success" : ""}`}
                            disabled={isSavingAdminAccess === user.id}
                            onClick={() => void handleSaveAdminAccess(user, {})}
                          >
                            {isSavingAdminAccess === user.id
                              ? "Saving..."
                              : adminSavedUserId === user.id
                                ? "Saved"
                                : "Save Access"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {settingsModalOpen && currentUser && (
          <div
            className="modal-backdrop"
            role="presentation"
            onClick={() => setSettingsModalOpen(false)}
          >
            <div
              className="modal-panel modal-panel--settings"
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-panel__header">
                <div>
                  <p className="results__eyebrow">Settings</p>
                  <h2 id="settings-modal-title">Workspace Settings</h2>
                </div>
                <button
                  type="button"
                  className="modal-panel__close"
                  onClick={() => setSettingsModalOpen(false)}
                  aria-label="Close settings modal"
                >
                  ✕
                </button>
              </div>

              <div className="modal-panel__body modal-panel__body--settings">
                <section className="settings-card">
                  <div className="settings-card__identity">
                    <UserAvatar user={currentUser} className="settings-card__avatar" />
                    <div>
                      <h3>{currentUser.name}</h3>
                      <p>{currentUser.email}</p>
                    </div>
                  </div>
                  <div className="settings-card__grid">
                    <div>
                      <span>Provider</span>
                      <strong>Google</strong>
                    </div>
                    <div>
                      <span>Plan</span>
                      <strong>{currentUser.plan === "free" ? "Free" : currentUser.plan}</strong>
                    </div>
                    <div>
                      <span>Session</span>
                      <strong>Persistent browser session</strong>
                    </div>
                    <div>
                      <span>Workspace scope</span>
                      <strong>Your quizzes stay private to this account</strong>
                    </div>
                  </div>
                </section>

                <section className="settings-card settings-card--danger">
                  <div>
                    <p className="results__eyebrow">Data Management</p>
                    <h3>Clear all study data</h3>
                    <p>
                      Remove all quizzes, attempts, scores, downloaded reports history, and analytics
                      snapshots stored under this account.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="submit-button submit-button--danger"
                    onClick={() => setClearDataConfirmOpen(true)}
                  >
                    Clear All Data
                  </button>
                </section>
              </div>
            </div>
          </div>
        )}

        {clearDataConfirmOpen && (
          <div
            className="modal-backdrop"
            role="presentation"
            onClick={() => setClearDataConfirmOpen(false)}
          >
            <div
              className="confirm-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="clear-data-title"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="results__eyebrow">Clear Data</p>
              <h2 id="clear-data-title">Delete every saved quiz, score, and attempt?</h2>
              <p>Your account stays active, but all workspace data under it will be removed.</p>
              <div className="confirm-panel__actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setClearDataConfirmOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="submit-button submit-button--danger"
                  disabled={isClearingData}
                  onClick={() => void handleClearAllDataConfirmed()}
                >
                  {isClearingData ? "Clearing..." : "Clear All Data"}
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteTarget && (
          <div
            className="modal-backdrop"
            role="presentation"
            onClick={() => setDeleteTarget(null)}
          >
            <div
              className="confirm-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-quiz-title"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="results__eyebrow">Delete Quiz</p>
              <h2 id="delete-quiz-title">Delete "{deleteTarget.title}"?</h2>
              <p>This action cannot be undone.</p>
              <div className="confirm-panel__actions">
                <button type="button" className="ghost-button" onClick={() => setDeleteTarget(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="submit-button submit-button--danger"
                  disabled={isDeletingQuiz}
                  onClick={() => void handleDeleteQuizConfirmed()}
                >
                  {isDeletingQuiz ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
