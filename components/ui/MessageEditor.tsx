"use client";

import { useId } from "react";

interface MessageEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}

function countWords(text: string): number {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

export default function MessageEditor({
  value,
  onChange,
  readOnly = false,
  placeholder = "El mensaje de tu ser querido aparecerá aquí...",
}: MessageEditorProps) {
  const textareaId = useId();
  const wordCount = countWords(value);

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Label */}
      {!readOnly && (
        <label
          htmlFor={textareaId}
          className="font-sans text-sm text-texto-muted"
        >
          Este es tu mensaje. Puedes ajustarlo si quieres.
        </label>
      )}

      {/* Textarea */}
      <div className="relative flex-1">
        <textarea
          id={textareaId}
          value={value}
          onChange={readOnly ? undefined : (e) => onChange?.(e.target.value)}
          readOnly={readOnly}
          placeholder={placeholder}
          rows={12}
          className={`
            w-full h-full min-h-[280px]
            font-serif text-body-md text-texto-principal
            leading-[1.8]
            bg-beige-dark/60
            rounded-card
            px-6 py-6
            resize-none
            border-0 outline-none
            placeholder:text-texto-muted/50 placeholder:font-sans placeholder:font-light
            focus:bg-beige-dark/80
            transition-colors duration-300
            ${readOnly ? "cursor-default select-text" : ""}
          `}
          aria-label="Mensaje escrito"
          aria-multiline="true"
        />

        {/* Subtle inner border on focus (non-readOnly) */}
        {!readOnly && (
          <div className="absolute inset-0 rounded-card ring-1 ring-transparent focus-within:ring-terracota/20 pointer-events-none transition-all duration-300" />
        )}
      </div>

      {/* Word count */}
      <div className="flex justify-end">
        <span
          className={`font-sans text-xs transition-colors duration-300 ${
            wordCount === 0
              ? "text-transparent"
              : "text-texto-muted"
          }`}
          aria-live="polite"
          aria-label={`${wordCount} palabras`}
        >
          {wordCount} {wordCount === 1 ? "palabra" : "palabras"}
        </span>
      </div>
    </div>
  );
}
