import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

// This plugin adds custom styling to template tags like {{tag_name}}
export const TemplateTagExtension = Extension.create({
  name: 'templateTag',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('templateTag'),
        props: {
          decorations(state) {
            const { doc } = state;
            const decorations: Decoration[] = [];

            // Regular expression to find template tags
            const tagRegex = /\{\{([a-z_]+)\}\}/g;

            // Loop through all text nodes in the document
            doc.descendants((node, pos) => {
              if (node.isText) {
                const text = node.text || '';
                let match;
                
                // Find all matches in the current text node
                while ((match = tagRegex.exec(text)) !== null) {
                  const start = pos + match.index;
                  const end = start + match[0].length;
                  
                  // Create a decoration for this tag
                  decorations.push(
                    Decoration.inline(start, end, {
                      class: 'template-tag',
                      'data-tag-name': match[1]
                    })
                  );
                }
              }
            });

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});

export default TemplateTagExtension;