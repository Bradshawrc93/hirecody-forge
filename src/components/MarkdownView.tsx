"use client";

import ReactMarkdown from "react-markdown";

interface Props {
  content: string;
  className?: string;
}

export function MarkdownView({ content, className }: Props) {
  return (
    <div
      className={`markdown-body text-sm leading-relaxed ${className ?? ""}`}
    >
      <ReactMarkdown
        components={{
          a: (props) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer"
              className="text-[color:var(--color-primary)] hover:underline"
            />
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = /language-/.test(className ?? "");
            if (isBlock) {
              return (
                <code
                  className="block overflow-x-auto rounded bg-[color:var(--color-card)] p-3 font-mono text-xs"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded bg-[color:var(--color-card)] px-1 py-0.5 font-mono text-xs"
                {...props}
              >
                {children}
              </code>
            );
          },
          h1: (props) => <h1 className="mt-4 mb-2 text-xl font-bold" {...props} />,
          h2: (props) => <h2 className="mt-4 mb-2 text-lg font-bold" {...props} />,
          h3: (props) => <h3 className="mt-3 mb-1 text-base font-bold" {...props} />,
          ul: (props) => <ul className="my-2 ml-5 list-disc space-y-1" {...props} />,
          ol: (props) => <ol className="my-2 ml-5 list-decimal space-y-1" {...props} />,
          p: (props) => <p className="my-2" {...props} />,
          blockquote: (props) => (
            <blockquote
              className="my-2 border-l-4 border-[color:var(--color-border)] pl-3 italic text-[color:var(--color-muted-foreground)]"
              {...props}
            />
          ),
          hr: () => <hr className="my-4 border-[color:var(--color-border)]" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
