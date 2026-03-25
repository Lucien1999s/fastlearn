import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type {
  DifficultyLevel,
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

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8000/api";

const DIFFICULTY_OPTIONS: Array<{ value: DifficultyLevel; label: string }> = [
  { value: "very_easy", label: "Very Easy" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
  { value: "very_hard", label: "Very Hard" },
];

const MAX_CONTENT_LENGTH = 10000;
const MAX_QUESTION_COUNT = 25;
const MAX_TITLE_LENGTH = 15;
const DEFAULT_PREFERENCE = "";
const DEFAULT_NUMBERS = "10";

const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  very_easy: "Very Easy",
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  very_hard: "Very Hard",
};

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
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

function summarizeAnswer(answer: string | string[]): string {
  return Array.isArray(answer) ? answer.join(", ") : answer;
}

function formatQuestionCount(count: number): string {
  return `${count} ${count === 1 ? "Question" : "Questions"}`;
}

function formatScoreValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
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
  };
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
    `Created: ${formatDate(quiz.created_at)}`,
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
          <span class="pdf-question__type">${escapeHtml(question.type)}</span>
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
          <span className="question-card__type">{question.type}</span>
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [knowledgeModalOpen, setKnowledgeModalOpen] = useState(false);
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
  const [quizPhase, setQuizPhase] = useState<QuizPhase>("answering");
  const [downloadTarget, setDownloadTarget] = useState<DownloadDocumentType>("quiz");
  const [userAnswers, setUserAnswers] = useState<Record<number, UserAnswer>>({});
  const [scoreResult, setScoreResult] = useState<QuizScoreResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const questionsRef = useRef<HTMLElement | null>(null);
  const shouldScrollToQuestionsRef = useRef(false);
  const availableReport = scoreResult ?? currentQuiz?.score_result ?? null;

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      setIsLoadingHistory(true);
      setErrorMessage(null);

      try {
        const items = await fetchJson<QuizHistoryItem[]>("/quizzes");
        if (!active) {
          return;
        }

        setHistory(items);

        if (items.length > 0) {
          const detail = await fetchJson<QuizWorkflowResponse>(`/quizzes/${items[0].id}`);
          if (!active) {
            return;
          }

          hydrateQuiz(detail);
        }
      } catch (error) {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : "Unable to load quiz history.");
        }
      } finally {
        if (active) {
          setIsLoadingHistory(false);
        }
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, []);

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
    setKnowledgeModalOpen(false);
    setDownloadModalOpen(false);
    setDeleteTarget(null);
    setQuizPhase("answering");
    setUserAnswers({});
    setScoreResult(null);
    panelRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSelectHistoryItem(quizId: string) {
    setSelectedQuizId(quizId);
    setEditingTitleId(null);
    setErrorMessage(null);

    try {
      const detail = await fetchJson<QuizWorkflowResponse>(`/quizzes/${quizId}`);
      hydrateQuiz(detail);
      setMenuOpen(false);
      panelRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load the selected quiz.");
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
      setErrorMessage(error instanceof Error ? error.message : "Unable to update title.");
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
      setErrorMessage(error instanceof Error ? error.message : "Unable to delete quiz.");
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
      setErrorMessage(error instanceof Error ? error.message : "Quiz scoring failed.");
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

  function handleRetake() {
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
      shouldScrollToQuestionsRef.current = true;
      setHistory((previous) => [toHistoryItem(quiz), ...previous.filter((item) => item.id !== quiz.id)]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Quiz generation failed.");
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
                              {formatDate(item.created_at)} · {formatQuestionCount(item.numbers)}
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
                              d="M4 15.75V20h4.25L19.06 9.19l-4.25-4.25L4 15.75Zm12.92-9.83 2.16-2.16a1.5 1.5 0 0 1 2.12 0l1.04 1.04a1.5 1.5 0 0 1 0 2.12l-2.16 2.16-3.16-3.16Z"
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
                  onClick={() => setMenuOpen((open) => !open)}
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
                    <button type="button">Settings</button>
                    <button type="button">Personalize</button>
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
                  <span>{formatDate(currentQuiz.created_at)}</span>
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
