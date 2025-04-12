import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import Strike from '@tiptap/extension-strike';
import Link from '@tiptap/extension-link';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import Heading from '@tiptap/extension-heading';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { useState, useEffect, useCallback } from 'react';
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Underline as UnderlineIcon,
  Strikethrough as StrikethroughIcon,
  Link as LinkIcon,
  List as BulletListIcon,
  ListOrdered as OrderedListIcon,
  Heading1,
  Heading2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface TiptapEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  maxHeight?: string;
  className?: string;
  minHeight?: string;
  readOnly?: boolean;
}

export function TiptapEditor({
  content,
  onChange,
  placeholder = 'Write something...',
  maxHeight = '200px',
  minHeight = '100px',
  className,
  readOnly = false
}: TiptapEditorProps) {
  const [linkUrl, setLinkUrl] = useState('');
  const [isEdited, setIsEdited] = useState(false);

  // Initialize the editor
  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      StarterKit.configure({
        document: false,
        paragraph: false, 
        text: false,
        bulletList: false,
        orderedList: false,
        listItem: false
      }),
      Bold,
      Italic,
      Underline,
      Strike,
      Link.configure({
        openOnClick: true,
        linkOnPaste: true,
      }),
      BulletList,
      OrderedList,
      ListItem,
      Heading.configure({
        levels: [1, 2],
      }),
    ],
    content: content || '',
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html);
      setIsEdited(true);
    },
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm focus:outline-none',
          'max-w-none w-full p-3 rounded-md',
          readOnly ? 'bg-muted cursor-default' : 'bg-background',
          className
        ),
      },
    },
  }, []);

  // Update content from props if it changes and the user hasn't edited the content yet
  useEffect(() => {
    if (editor && content && !isEdited) {
      editor.commands.setContent(content);
    }
  }, [content, editor, isEdited]);

  // Handle link insertion
  const setLink = useCallback(() => {
    if (!linkUrl || !editor) return;
    
    // Check if the link has a protocol
    const linkWithProtocol = /^https?:\/\//.test(linkUrl) 
      ? linkUrl 
      : `https://${linkUrl}`;
      
    editor.chain().focus().extendMarkRange('link').setLink({ href: linkWithProtocol }).run();
    setLinkUrl('');
  }, [editor, linkUrl]);

  // If the editor isn't ready, show a loading state
  if (!editor) {
    return (
      <div className="border rounded-md p-3 text-muted-foreground">
        Loading editor...
      </div>
    );
  }

  return (
    <div className="relative">
      {editor && (
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 100 }}
          className="bg-background border rounded-md shadow-md flex p-1"
        >
          <Toggle
            size="sm"
            pressed={editor.isActive('bold')}
            onPressedChange={() => editor.chain().focus().toggleBold().run()}
            aria-label="Bold"
          >
            <BoldIcon className="h-4 w-4" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive('italic')}
            onPressedChange={() => editor.chain().focus().toggleItalic().run()}
            aria-label="Italic"
          >
            <ItalicIcon className="h-4 w-4" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive('underline')}
            onPressedChange={() => editor.chain().focus().toggleUnderline().run()}
            aria-label="Underline"
          >
            <UnderlineIcon className="h-4 w-4" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive('strike')}
            onPressedChange={() => editor.chain().focus().toggleStrike().run()}
            aria-label="Strike"
          >
            <StrikethroughIcon className="h-4 w-4" />
          </Toggle>
        </BubbleMenu>
      )}

      <div
        className={cn(
          'border rounded-md overflow-y-auto',
          {
            'bg-muted': readOnly,
            'hover:border-input focus-within:border-primary': !readOnly,
          },
          className
        )}
        style={{ maxHeight, minHeight }}
      >
        <EditorContent editor={editor} />
      </div>

      {!readOnly && (
        <div className="mt-1 flex flex-wrap gap-1">
          <Toggle
            size="sm"
            pressed={editor.isActive('bold')}
            onPressedChange={() => editor.chain().focus().toggleBold().run()}
            aria-label="Bold"
          >
            <BoldIcon className="h-4 w-4" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive('italic')}
            onPressedChange={() => editor.chain().focus().toggleItalic().run()}
            aria-label="Italic"
          >
            <ItalicIcon className="h-4 w-4" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive('underline')}
            onPressedChange={() => editor.chain().focus().toggleUnderline().run()}
            aria-label="Underline"
          >
            <UnderlineIcon className="h-4 w-4" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive('strike')}
            onPressedChange={() => editor.chain().focus().toggleStrike().run()}
            aria-label="Strike"
          >
            <StrikethroughIcon className="h-4 w-4" />
          </Toggle>
          
          <Popover>
            <PopoverTrigger asChild>
              <Toggle
                size="sm"
                pressed={editor.isActive('link')}
                aria-label="Link"
              >
                <LinkIcon className="h-4 w-4" />
              </Toggle>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <div className="flex">
                <Input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="flex-1 mr-2"
                />
                <Button size="sm" onClick={setLink}>Add</Button>
              </div>
            </PopoverContent>
          </Popover>
          
          <Toggle
            size="sm"
            pressed={editor.isActive('bulletList')}
            onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
            aria-label="Bullet List"
          >
            <BulletListIcon className="h-4 w-4" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive('orderedList')}
            onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
            aria-label="Ordered List"
          >
            <OrderedListIcon className="h-4 w-4" />
          </Toggle>
          
          <Toggle
            size="sm"
            pressed={editor.isActive('heading', { level: 1 })}
            onPressedChange={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            aria-label="Heading 1"
          >
            <Heading1 className="h-4 w-4" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive('heading', { level: 2 })}
            onPressedChange={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            aria-label="Heading 2"
          >
            <Heading2 className="h-4 w-4" />
          </Toggle>
        </div>
      )}
    </div>
  );
}