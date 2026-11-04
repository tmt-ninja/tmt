import { forwardRef } from 'react';
import type { Question } from '../questions.js';
import './question-line.css';

/** The waiting card's byline and title. */
export const QuestionLine = forwardRef<
  HTMLDivElement,
  {
    question: Question;
    agent?: string;
  }
>(function QuestionLine({ question, agent }, ref) {
  return (
    <div ref={ref} className="question-line question-waiting-heading" tabIndex={-1}>
      <span className="question-waiting-eyebrow">
        <span aria-hidden="true">●</span> {agent || question.agent || 'Agent'} asks you · Waiting
        for your answer
      </span>
      <span className="question-line-title">{question.title}</span>
    </div>
  );
});
