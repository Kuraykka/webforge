import { useEffect, useRef } from "react";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { html as htmlLanguage } from "@codemirror/lang-html";
import { css as cssLanguage } from "@codemirror/lang-css";
import { javascript as javascriptLanguage } from "@codemirror/lang-javascript";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import type { LanguageSupport } from "@codemirror/language";
import type { EditorLanguage } from "./languages";
import { useTheme } from "../theme/ThemeProvider";

export interface CursorPosition {
  line: number;
  column: number;
  offset: number;
}

export interface RevealRange {
  start: number;
  end: number;
  /** Cambia en cada petición para que el efecto vuelva a ejecutarse. */
  token: number;
  /** Lleva el foco al editor. En falso solo mueve el cursor y hace scroll. */
  focus: boolean;
}

interface CodeEditorProps {
  value: string;
  language: EditorLanguage;
  /** Cambiar de archivo reinicia el historial de deshacer del editor. */
  path: string;
  /** Sube solo cuando el texto llega de fuera; evita reimpone un texto más viejo al usuario. */
  revision: number;
  onChange: (next: string) => void;
  onCursor?: (position: CursorPosition) => void;
  onSave?: () => void;
  reveal?: RevealRange | null;
}

function languageExtension(language: EditorLanguage): LanguageSupport {
  switch (language) {
    case "html":
      return htmlLanguage();
    case "css":
      return cssLanguage();
    case "javascript":
      return javascriptLanguage();
    case "typescript":
      return javascriptLanguage({ typescript: true, jsx: true });
    case "json":
      return jsonLanguage();
    case "markdown":
      return markdownLanguage();
    default:
      return javascriptLanguage();
  }
}

const surfaceTheme = (dark: boolean) =>
  EditorView.theme(
    {
      "&": {
        height: "100%",
        fontSize: "13px",
        color: "var(--ink)",
        backgroundColor: "var(--surface-raised)"
      },
      ".cm-content": { fontFamily: "var(--font-mono)", caretColor: "var(--ink)" },
      ".cm-gutters": {
        backgroundColor: "var(--surface-muted)",
        color: "var(--ink-faint)",
        border: "none",
        borderRight: "1px solid var(--border-color)"
      },
      ".cm-activeLine": { backgroundColor: "var(--surface-muted)" },
      ".cm-activeLineGutter": { backgroundColor: "var(--surface-muted)", color: "var(--ink-muted)" },
      ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: dark ? "#1d4ed855" : "#bfdbfe" }
    },
    { dark }
  );

const languageCompartment = () => new Compartment();
const themeCompartment = () => new Compartment();

/**
 * Editor CodeMirror con búsqueda, plegado y autocompletado.
 * El deshacer NO vive aquí: `EditorWorkspace` intercepta Ctrl+Z en la fase de captura de
 * `window`, antes de que llegue a este DOM, así que el único histórico es el de
 * `useProjectFiles` y cubre a la vez lo escrito aquí y lo que cambia el constructor.
 */
export function CodeEditor({ value, language, path, revision, onChange, onCursor, onSave, reveal }: CodeEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const languagePanel = useRef(languageCompartment());
  const themePanel = useRef(themeCompartment());
  const callbacks = useRef({ onChange, onCursor, onSave });
  const applyingExternal = useRef(false);
  const { theme } = useTheme();
  callbacks.current = { onChange, onCursor, onSave };

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    const instance = new EditorView({
      parent: element,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          languagePanel.current.of(languageExtension(language)),
          themePanel.current.of(surfaceTheme(theme === "dark")),
          keymap.of([{ key: "Mod-s", preventDefault: true, run: () => callbacks.current.onSave?.() ?? true }]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !applyingExternal.current) {
              callbacks.current.onChange(update.state.doc.toString());
            }
            if (update.selectionSet) {
              const range = update.state.selection.main;
              const line = update.state.doc.lineAt(range.head);
              callbacks.current.onCursor?.({ line: line.number, column: range.head - line.from + 1, offset: range.head });
            }
          })
        ]
      })
    });

    view.current = instance;
    return () => {
      instance.destroy();
      view.current = null;
    };
    // `path` reinicia el editor: cada archivo tiene su propio historial de deshacer.
  }, [path]);

  useEffect(() => {
    view.current?.dispatch({ effects: languagePanel.current.reconfigure(languageExtension(language)) });
  }, [language]);

  useEffect(() => {
    view.current?.dispatch({ effects: themePanel.current.reconfigure(surfaceTheme(theme === "dark")) });
  }, [theme]);

  /**
   * Sincroniza con `revision`, no con `value`: al teclear rápido, React devuelve un texto más
   * viejo que el del editor. Reimponerlo borra lo último escrito y el DOM responde con otro
   * cambio, así que el ciclo se alimenta a sí mismo hasta agotar a React.
   */
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current === value) return;
    const selection = instance.state.selection.main;
    applyingExternal.current = true;
    instance.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor: Math.min(selection.anchor, value.length) },
      annotations: Transaction.userEvent.of("external")
    });
    applyingExternal.current = false;
    // `value` se lee al subir la revisión; no es un olvido.
  }, [revision, path]);

  useEffect(() => {
    const instance = view.current;
    if (!instance || !reveal) return;
    const length = instance.state.doc.length;
    const start = Math.min(reveal.start, length);
    const end = Math.min(reveal.end, length);
    instance.dispatch({ selection: { anchor: start, head: end }, scrollIntoView: true, effects: EditorView.scrollIntoView(start, { y: "center" }) });
    // Sin foco: la selección llegó de un clic en la vista previa, que está editando su propio texto.
    if (reveal.focus) instance.focus();
  }, [reveal]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" data-testid="code-editor" />;
}
