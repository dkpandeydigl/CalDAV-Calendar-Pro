import React, { useState, useEffect } from 'react';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough, List, ListOrdered, Link as LinkIcon, Heading1, Heading2, Quote, Undo, Redo, Maximize2, Minimize2, Hash } from 'lucide-react';
import { TemplateTagExtension } from './TemplateTagExtension';
import { processTemplateTags } from './templates';
import './description-editor.css';
import { 
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';

interface DescriptionEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  eventData?: any; // Event data for template tag replacement
}

const DescriptionEditor: React.FC<DescriptionEditorProps> = ({
  value,
  onChange,
  placeholder = 'Start typing...',
  eventData
}) => {
  const [linkUrl, setLinkUrl] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  
  // Process template tags if eventData is available
  useEffect(() => {
    if (eventData && value.includes('{{')) {
      const processedContent = processTemplateTags(value, eventData);
      if (processedContent !== value) {
        onChange(processedContent);
      }
    }
  }, [eventData, value, onChange]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link,
      Underline,
      TemplateTagExtension,
    ],
    content: value,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose max-w-none focus:outline-none',
        placeholder,
      },
    },
  });

  // Update editor content when value prop changes
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value);
    }
  }, [editor, value]);

  if (!editor) {
    return null;
  }

  // Handle formatting buttons
  const toggleBold = () => editor.chain().focus().toggleBold().run();
  const toggleItalic = () => editor.chain().focus().toggleItalic().run();
  const toggleUnderline = () => editor.chain().focus().toggleUnderline().run();
  const toggleStrike = () => editor.chain().focus().toggleStrike().run();
  
  // Handle heading buttons
  const toggleH1 = () => editor.chain().focus().toggleHeading({ level: 1 }).run();
  const toggleH2 = () => editor.chain().focus().toggleHeading({ level: 2 }).run();
  
  // Handle list buttons
  const toggleBulletList = () => editor.chain().focus().toggleBulletList().run();
  const toggleOrderedList = () => editor.chain().focus().toggleOrderedList().run();
  
  // Handle link
  const setLink = () => {
    if (linkUrl) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl, target: '_blank' }).run();
      setLinkUrl('');
      setShowLinkInput(false);
    }
  };
  
  const unsetLink = () => editor.chain().focus().extendMarkRange('link').unsetLink().run();
  
  // Handle block quote
  const toggleBlockquote = () => editor.chain().focus().toggleBlockquote().run();
  
  // Handle undo/redo
  const handleUndo = () => editor.chain().focus().undo().run();
  const handleRedo = () => editor.chain().focus().redo().run();

  return (
    <div className={`editor-container ${isFullScreen ? 'fullscreen' : ''}`}>
      <div className="editor-toolbar">
        {/* Text formatting */}
        <button
          type="button"
          onClick={toggleBold}
          className={`toolbar-button ${editor.isActive('bold') ? 'is-active' : ''}`}
          title="Bold"
        >
          <Bold size={18} />
        </button>
        <button
          type="button"
          onClick={toggleItalic}
          className={`toolbar-button ${editor.isActive('italic') ? 'is-active' : ''}`}
          title="Italic"
        >
          <Italic size={18} />
        </button>
        <button
          type="button"
          onClick={toggleUnderline}
          className={`toolbar-button ${editor.isActive('underline') ? 'is-active' : ''}`}
          title="Underline"
        >
          <UnderlineIcon size={18} />
        </button>
        <button
          type="button"
          onClick={toggleStrike}
          className={`toolbar-button ${editor.isActive('strike') ? 'is-active' : ''}`}
          title="Strikethrough"
        >
          <Strikethrough size={18} />
        </button>
        
        <div className="toolbar-divider" />
        
        {/* Headings */}
        <button
          type="button"
          onClick={toggleH1}
          className={`toolbar-button ${editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}`}
          title="Heading 1"
        >
          <Heading1 size={18} />
        </button>
        <button
          type="button"
          onClick={toggleH2}
          className={`toolbar-button ${editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}`}
          title="Heading 2"
        >
          <Heading2 size={18} />
        </button>
        
        <div className="toolbar-divider" />
        
        {/* Lists */}
        <button
          type="button"
          onClick={toggleBulletList}
          className={`toolbar-button ${editor.isActive('bulletList') ? 'is-active' : ''}`}
          title="Bullet List"
        >
          <List size={18} />
        </button>
        <button
          type="button"
          onClick={toggleOrderedList}
          className={`toolbar-button ${editor.isActive('orderedList') ? 'is-active' : ''}`}
          title="Ordered List"
        >
          <ListOrdered size={18} />
        </button>
        
        <div className="toolbar-divider" />
        
        {/* Quote */}
        <button
          type="button"
          onClick={toggleBlockquote}
          className={`toolbar-button ${editor.isActive('blockquote') ? 'is-active' : ''}`}
          title="Block Quote"
        >
          <Quote size={18} />
        </button>
        
        {/* Link */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowLinkInput(!showLinkInput)}
            className={`toolbar-button ${editor.isActive('link') ? 'is-active' : ''}`}
            title="Link"
          >
            <LinkIcon size={18} />
          </button>
          
          {showLinkInput && (
            <div className="absolute top-full left-0 mt-1 p-2 bg-background border border-border rounded-md shadow-md z-10 flex items-center gap-2">
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-36 px-2 py-1 text-sm border border-input rounded-md"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setLink();
                  }
                }}
                autoFocus
              />
              <button 
                type="button" 
                onClick={setLink}
                className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded-md"
              >
                Set
              </button>
              <button 
                type="button" 
                onClick={() => setShowLinkInput(false)}
                className="px-2 py-1 text-xs bg-secondary text-secondary-foreground rounded-md"
              >
                Cancel
              </button>
              {editor.isActive('link') && (
                <button 
                  type="button" 
                  onClick={unsetLink}
                  className="px-2 py-1 text-xs bg-destructive text-destructive-foreground rounded-md"
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </div>
        
        <div className="toolbar-divider" />
        
        {/* Undo/Redo */}
        <button
          type="button"
          onClick={handleUndo}
          className="toolbar-button"
          disabled={!editor.can().undo()}
          title="Undo"
        >
          <Undo size={18} />
        </button>
        <button
          type="button"
          onClick={handleRedo}
          className="toolbar-button"
          disabled={!editor.can().redo()}
          title="Redo"
        >
          <Redo size={18} />
        </button>
        
        <div className="toolbar-divider" />
        
        {/* Template Tags */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="toolbar-button"
              title="Insert Template Tag"
            >
              <Hash size={18} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-60" sideOffset={5}>
            <div className="space-y-2">
              <h4 className="font-medium">Insert Template Tag</h4>
              <div className="grid gap-1">
                <button
                  type="button"
                  className="text-left text-sm px-2 py-1 rounded hover:bg-muted"
                  onClick={() => editor.chain().focus().insertContent("{{title}}").run()}
                >
                  <code>&#123;&#123;title&#125;&#125;</code> - Event title
                </button>
                <button
                  type="button"
                  className="text-left text-sm px-2 py-1 rounded hover:bg-muted"
                  onClick={() => editor.chain().focus().insertContent("{{location}}").run()}
                >
                  <code>&#123;&#123;location&#125;&#125;</code> - Event location
                </button>
                <button
                  type="button"
                  className="text-left text-sm px-2 py-1 rounded hover:bg-muted"
                  onClick={() => editor.chain().focus().insertContent("{{date}}").run()}
                >
                  <code>&#123;&#123;date&#125;&#125;</code> - Event date
                </button>
                <button
                  type="button"
                  className="text-left text-sm px-2 py-1 rounded hover:bg-muted"
                  onClick={() => editor.chain().focus().insertContent("{{startTime}}").run()}
                >
                  <code>&#123;&#123;startTime&#125;&#125;</code> - Start time
                </button>
                <button
                  type="button"
                  className="text-left text-sm px-2 py-1 rounded hover:bg-muted"
                  onClick={() => editor.chain().focus().insertContent("{{endTime}}").run()}
                >
                  <code>&#123;&#123;endTime&#125;&#125;</code> - End time
                </button>
                <button
                  type="button"
                  className="text-left text-sm px-2 py-1 rounded hover:bg-muted"
                  onClick={() => editor.chain().focus().insertContent("{{attendees}}").run()}
                >
                  <code>&#123;&#123;attendees&#125;&#125;</code> - List of attendees
                </button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        
        {/* Fullscreen Toggle */}
        <button
          type="button"
          onClick={() => setIsFullScreen(!isFullScreen)}
          className="toolbar-button"
          title={isFullScreen ? "Exit Full Screen" : "Full Screen"}
        >
          {isFullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>
      
      <div className="editor-content">
        <EditorContent editor={editor} />
      </div>
      
      {editor && (
        <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }}>
          <div className="flex bg-background border border-border rounded-md shadow-md">
            <button
              onClick={toggleBold}
              className={`toolbar-button p-1 ${editor.isActive('bold') ? 'is-active' : ''}`}
              title="Bold"
            >
              <Bold size={14} />
            </button>
            <button
              onClick={toggleItalic}
              className={`toolbar-button p-1 ${editor.isActive('italic') ? 'is-active' : ''}`}
              title="Italic"
            >
              <Italic size={14} />
            </button>
            <button
              onClick={toggleUnderline}
              className={`toolbar-button p-1 ${editor.isActive('underline') ? 'is-active' : ''}`}
              title="Underline"
            >
              <UnderlineIcon size={14} />
            </button>
            <button
              onClick={toggleStrike}
              className={`toolbar-button p-1 ${editor.isActive('strike') ? 'is-active' : ''}`}
              title="Strikethrough"
            >
              <Strikethrough size={14} />
            </button>
            <button
              onClick={() => setShowLinkInput(!showLinkInput)}
              className={`toolbar-button p-1 ${editor.isActive('link') ? 'is-active' : ''}`}
              title="Link"
            >
              <LinkIcon size={14} />
            </button>
          </div>
        </BubbleMenu>
      )}
    </div>
  );
};

export default DescriptionEditor;