import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Custom TipTap extension for highlighting template tags like {{name}}
 * in a distinct color to make them stand out in the editor
 */
export const TemplateTagExtension = Extension.create({
  name: 'templateTag',

  addProseMirrorPlugins() {
    const templateTagKey = new PluginKey('templateTag');
    
    return [
      new Plugin({
        key: templateTagKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, set) {
            // Adjust decorations to changes made by the transaction
            set = set.map(tr.mapping, tr.doc);
            
            // Don't bother if this transaction doesn't change the doc
            if (!tr.docChanged) {
              return set;
            }
            
            // Find all template tags {{...}} in the document
            const templateTags: Decoration[] = [];
            const templateTagRegex = /\{\{(\w+)\}\}/g;
            
            tr.doc.forEach((node, pos) => {
              if (!node.text) return;
              
              let match;
              while ((match = templateTagRegex.exec(node.text)) !== null) {
                const start = pos + match.index;
                const end = start + match[0].length;
                
                templateTags.push(
                  Decoration.inline(start, end, {
                    class: 'template-tag',
                    'data-tag-name': match[1]
                  })
                );
              }
            });
            
            return DecorationSet.create(tr.doc, templateTags);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});