import React, { useState, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { 
  Bold, 
  Italic, 
  Underline as UnderlineIcon, 
  Link as LinkIcon, 
  List, 
  ListOrdered, 
  Heading1, 
  Heading2
} from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { 
  Popover, 
  PopoverContent, 
  PopoverTrigger 
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface TiptapProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}

export const Tiptap: React.FC<TiptapProps> = ({ 
  content, 
  onChange,
  placeholder = 'Enter content here...',
  readOnly = false
}) => {
  const [linkUrl, setLinkUrl] = useState('');
  const [showLinkPopover, setShowLinkPopover] = useState(false);
  
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-500 underline',
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
    ],
    content,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm focus:outline-none min-h-[100px] px-3 py-2',
        placeholder,
      },
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  const setLink = () => {
    if (!linkUrl) return;
    
    editor?.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run();
    setLinkUrl('');
    setShowLinkPopover(false);
  };

  const unsetLink = () => {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    setShowLinkPopover(false);
  };
  
  if (!editor) {
    return <div>Loading editor...</div>;
  }

  return (
    <div className="border-none">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1 p-1 border-b">
          <Toggle
            size="sm"
            pressed={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
            aria-label="Bold"
            className="data-[state=on]:bg-muted"
          >
            <Bold className="h-4 w-4" />
          </Toggle>
          
          <Toggle
            size="sm"
            pressed={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            aria-label="Italic"
            className="data-[state=on]:bg-muted"
          >
            <Italic className="h-4 w-4" />
          </Toggle>
          
          <Toggle
            size="sm"
            pressed={editor.isActive('underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            aria-label="Underline"
            className="data-[state=on]:bg-muted"
          >
            <UnderlineIcon className="h-4 w-4" />
          </Toggle>
          
          <Popover open={showLinkPopover} onOpenChange={setShowLinkPopover}>
            <PopoverTrigger asChild>
              <Toggle
                size="sm"
                pressed={editor.isActive('link')}
                aria-label="Link"
                className="data-[state=on]:bg-muted"
              >
                <LinkIcon className="h-4 w-4" />
              </Toggle>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-3">
              <div className="flex flex-col space-y-2">
                <div className="flex items-center space-x-2">
                  <Input
                    placeholder="https://example.com"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    className="flex-1"
                  />
                </div>
                <div className="flex justify-end space-x-2">
                  {editor.isActive('link') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={unsetLink}
                    >
                      Remove
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={setLink}
                    disabled={!linkUrl}
                  >
                    Save
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          
          <div className="border-l mx-1 h-6" />
          
          <Toggle
            size="sm"
            pressed={editor.isActive('heading', { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            aria-label="Heading 1"
            className="data-[state=on]:bg-muted"
          >
            <Heading1 className="h-4 w-4" />
          </Toggle>
          
          <Toggle
            size="sm"
            pressed={editor.isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            aria-label="Heading 2"
            className="data-[state=on]:bg-muted"
          >
            <Heading2 className="h-4 w-4" />
          </Toggle>
          
          <div className="border-l mx-1 h-6" />
          
          <Toggle
            size="sm"
            pressed={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            aria-label="Bullet List"
            className="data-[state=on]:bg-muted"
          >
            <List className="h-4 w-4" />
          </Toggle>
          
          <Toggle
            size="sm"
            pressed={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            aria-label="Ordered List"
            className="data-[state=on]:bg-muted"
          >
            <ListOrdered className="h-4 w-4" />
          </Toggle>
        </div>
      )}
      
      <EditorContent editor={editor} className="min-h-[100px]" />
    </div>
  );
};