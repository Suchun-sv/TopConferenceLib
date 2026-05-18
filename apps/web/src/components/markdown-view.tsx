"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownView({ source }: { source: string }) {
  return (
    <div className="ai-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline" />
          ),
          code: ({ inline, className, children, ...props }: any) =>
            inline ? (
              <code className="rounded bg-zinc-200/60 px-1 py-0.5 text-[12px]" {...props}>
                {children}
              </code>
            ) : (
              <pre className="my-2 overflow-x-auto rounded bg-zinc-900 p-2 text-[12px] text-zinc-100">
                <code className={className} {...props}>
                  {children}
                </code>
              </pre>
            ),
          table: ({ node, ...props }) => (
            <div className="my-2 overflow-x-auto">
              <table {...props} className="min-w-full border-collapse border border-zinc-200 text-xs" />
            </div>
          ),
          th: (props) => <th {...props} className="border border-zinc-200 bg-zinc-50 px-2 py-1 text-left" />,
          td: (props) => <td {...props} className="border border-zinc-200 px-2 py-1 align-top" />,
          ul: (props) => <ul {...props} className="my-2 list-disc pl-5" />,
          ol: (props) => <ol {...props} className="my-2 list-decimal pl-5" />,
          p: (props) => <p {...props} className="my-1.5 leading-relaxed" />,
          h1: (props) => <h1 {...props} className="mt-2 mb-1 text-base font-semibold" />,
          h2: (props) => <h2 {...props} className="mt-2 mb-1 text-sm font-semibold" />,
          h3: (props) => <h3 {...props} className="mt-2 mb-1 text-sm font-semibold" />,
          blockquote: (props) => (
            <blockquote
              {...props}
              className="my-2 border-l-2 border-zinc-300 pl-3 italic text-zinc-600"
            />
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
