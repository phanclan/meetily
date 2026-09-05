import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Model output is Markdown, never trusted HTML. */
export function AssistantMessage({ content }: { content: string }) {
  return (
    <div className="assistant-markdown min-w-0 break-words">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml>{content}</Markdown>
    </div>
  );
}
