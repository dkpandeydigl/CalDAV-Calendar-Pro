import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { 
  Bold, 
  Italic, 
  Underline as UnderlineIcon, 
  List, 
  ListOrdered, 
  Link as LinkIcon, 
  Heading1, 
  Heading2, 
  Maximize, 
  Minimize, 
  Code, 
  Eye, 
  Edit3, 
  FileText,
  Save
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import TemplateTagExtension from './TemplateTagExtension';
import { 
  AVAILABLE_TAGS, 
  PLACEHOLDER_DATA, 
  PREDEFINED_TEMPLATES, 
  loadCustomTemplates, 
  replaceTemplateTags, 
  type DescriptionTemplate 
} from './templates';
import SavedTemplateManager from './SavedTemplateManager';
import './description-editor.css';

interface DescriptionEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const DescriptionEditor: React.FC<DescriptionEditorProps> = ({
  value,
  onChange,
  placeholder = 'Event Description'
}) => {
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [editorHeight, setEditorHeight] = useState('300px');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkMenuOpen, setLinkMenuOpen] = useState(false);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);

  // Initialize TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-500 underline',
        },
      }),
      TemplateTagExtension,
    ],
    content: value || '',
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose-base mx-auto focus:outline-none min-h-[200px] p-4',
      },
    },
  });

  // Update editor content when value prop changes
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || '');
    }
  }, [editor, value]);

  // Handle tag insertion
  const insertTag = useCallback((tagName: string) => {
    if (editor) {
      editor.chain().focus().insertContent(`{{${tagName}}}`).run();
    }
  }, [editor]);

  // Handle template insertion
  const insertTemplate = useCallback((templateName: string) => {
    const template = PREDEFINED_TEMPLATES.find(t => t.name === templateName);
    if (editor && template) {
      editor.commands.setContent(template.content);
    }
  }, [editor]);

  // Handle link insertion
  const setLink = useCallback(() => {
    if (editor && linkUrl) {
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: linkUrl })
        .run();
      setLinkUrl('');
      setLinkMenuOpen(false);
    }
  }, [editor, linkUrl]);

  // Toggle fullscreen mode
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
    setEditorHeight(isFullscreen ? '300px' : '80vh');
  }, [isFullscreen]);

  // Preview mode functions
  const getPreviewContent = useCallback(() => {
    if (!editor) return '';
    let content = editor.getHTML();
    
    // Replace all tags with their values
    return replaceTemplateTags(content, PLACEHOLDER_DATA);
  }, [editor]);

  // Calculate styles based on fullscreen state
  const containerStyles = {
    position: isFullscreen ? 'fixed' : 'relative',
    top: isFullscreen ? '0' : 'auto',
    left: isFullscreen ? '0' : 'auto',
    right: isFullscreen ? '0' : 'auto',
    bottom: isFullscreen ? '0' : 'auto',
    zIndex: isFullscreen ? '50' : 'auto',
    backgroundColor: isFullscreen ? 'white' : 'transparent',
    padding: isFullscreen ? '20px' : '0',
    borderRadius: isFullscreen ? '0' : '4px',
    width: isFullscreen ? '100%' : '100%',
    height: isFullscreen ? '100vh' : 'auto',
    boxShadow: isFullscreen ? '0 0 10px rgba(0,0,0,0.1)' : 'none',
    transition: 'all 0.3s ease',
  } as React.CSSProperties;

  const editorContainerStyles = {
    height: editorHeight,
    overflow: 'auto',
    transition: 'height 0.3s ease',
    border: '1px solid #e2e8f0',
    borderRadius: '4px',
  } as React.CSSProperties;

  if (!editor) {
    return <div>Loading editor...</div>;
  }

  return (
    <div ref={editorContainerRef} style={containerStyles} className="description-editor-container">
      {/* Main Toolbar */}
      <div className="flex flex-wrap gap-2 mb-2 p-2 bg-gray-50 border border-gray-200 rounded-md">
        {/* Text formatting controls */}
        <div className="flex items-center gap-1 mr-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={editor.isActive('bold') ? 'bg-gray-200' : ''}
            aria-label="Bold"
          >
            <Bold size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={editor.isActive('italic') ? 'bg-gray-200' : ''}
            aria-label="Italic"
          >
            <Italic size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={editor.isActive('underline') ? 'bg-gray-200' : ''}
            aria-label="Underline"
          >
            <UnderlineIcon size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={editor.isActive('heading', { level: 2 }) ? 'bg-gray-200' : ''}
            aria-label="Heading 2"
          >
            <Heading2 size={16} />
          </Button>
        </div>

        {/* List controls */}
        <div className="flex items-center gap-1 mr-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={editor.isActive('bulletList') ? 'bg-gray-200' : ''}
            aria-label="Bullet List"
          >
            <List size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={editor.isActive('orderedList') ? 'bg-gray-200' : ''}
            aria-label="Numbered List"
          >
            <ListOrdered size={16} />
          </Button>
        </div>

        {/* Link control */}
        <div className="flex items-center gap-1 mr-4">
          <Popover open={linkMenuOpen} onOpenChange={setLinkMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={editor.isActive('link') ? 'bg-gray-200' : ''}
                aria-label="Link"
              >
                <LinkIcon size={16} />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <div className="flex flex-col gap-2">
                <Label htmlFor="link-url">URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="link-url"
                    value={linkUrl}
                    onChange={e => setLinkUrl(e.target.value)}
                    placeholder="https://example.com"
                  />
                  <Button size="sm" onClick={setLink}>Apply</Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Tag insertion */}
        <div className="flex items-center gap-1 mr-4">
          <Select onValueChange={insertTag}>
            <SelectTrigger className="h-8 w-36">
              <SelectValue placeholder="Insert Tag" />
            </SelectTrigger>
            <SelectContent>
              {AVAILABLE_TAGS.map(tag => (
                <SelectItem key={tag.name} value={tag.name}>
                  {tag.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Template insertion */}
        <div className="flex items-center gap-1 mr-4">
          <Select onValueChange={insertTemplate}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue placeholder="Select Template" />
            </SelectTrigger>
            <SelectContent>
              {PREDEFINED_TEMPLATES.map(template => (
                <SelectItem key={template.id} value={template.name}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Preview mode toggle */}
        <div className="flex items-center gap-1 mr-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsPreviewMode(!isPreviewMode)}
            className="ml-auto"
          >
            {isPreviewMode ? (
              <>
                <Edit3 size={16} className="mr-2" /> Edit
              </>
            ) : (
              <>
                <Eye size={16} className="mr-2" /> Preview
              </>
            )}
          </Button>
        </div>

        {/* Fullscreen toggle */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleFullscreen}
            className="ml-auto"
          >
            {isFullscreen ? (
              <>
                <Minimize size={16} className="mr-2" /> Exit Fullscreen
              </>
            ) : (
              <>
                <Maximize size={16} className="mr-2" /> Fullscreen
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Editor Content */}
      <div style={editorContainerStyles} className="bg-white">
        {isPreviewMode ? (
          <div
            className="prose max-w-none p-4 min-h-[200px]"
            dangerouslySetInnerHTML={{ __html: getPreviewContent() }}
          />
        ) : (
          <EditorContent editor={editor} />
        )}
      </div>

      {/* Tag legend */}
      {!isPreviewMode && (
        <div className="mt-2 text-xs text-gray-500">
          <p>Available tags: {AVAILABLE_TAGS.map(tag => `{{${tag.name}}}`).join(', ')}</p>
        </div>
      )}
    </div>
  );
};

export default DescriptionEditor;