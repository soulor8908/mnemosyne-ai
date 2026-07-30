// Markdown 预览组件：从 notes/[id] 编辑器抽出，配合 next/dynamic 懒加载。
// 这样 react-markdown + remark-gfm + micromark 整套（≈140KB）只在实际渲染预览时
// 才作为独立 chunk 加载，不进入编辑器页的 First Load JS。
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownPreviewProps {
  content: string;
  components?: React.ComponentProps<typeof ReactMarkdown>['components'];
}

export default function MarkdownPreview({ content, components }: MarkdownPreviewProps) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content || '*预览区为空*'}
    </ReactMarkdown>
  );
}
