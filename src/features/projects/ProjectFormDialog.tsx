import { useEffect, useId, useState, type FormEvent } from "react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { Input, Label, Textarea } from "../../components/ui/Field";
import { STACK_OPTIONS, type NewProjectInput, type Project, type StackId } from "./types";
import { parseTags } from "../../lib/format";

interface Props {
  open: boolean;
  project?: Project | null;
  folderSuggestions: string[];
  onClose: () => void;
  onSubmit: (input: NewProjectInput) => Promise<void>;
}

export function ProjectFormDialog({ open, project, folderSuggestions, onClose, onSubmit }: Props) {
  const formId = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [folder, setFolder] = useState("Sin carpeta");
  const [tagsRaw, setTagsRaw] = useState("");
  const [stack, setStack] = useState<StackId>("static");
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setFolder(project?.folder ?? "Sin carpeta");
    setTagsRaw(project?.tags.join(", ") ?? "");
    setStack(project?.stack ?? "static");
    setNameError(null);
    setBusy(false);
  }, [open, project]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("El nombre es obligatorio.");
      return;
    }
    if (trimmed.length > 80) {
      setNameError("El nombre no puede superar 80 caracteres.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        name: trimmed,
        description: description.trim(),
        folder: folder.trim() || "Sin carpeta",
        tags: parseTags(tagsRaw),
        stack
      });
      onClose();
    } catch {
      // El que llama ya ha avisado del fallo: aquí el formulario se queda abierto para reintentar.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={project ? "Editar proyecto" : "Nuevo proyecto"}
      description={
        project
          ? "Actualiza la información de este proyecto."
          : "Crea un proyecto desde cero. Las plantillas completas llegan en una fase posterior."
      }
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <Label htmlFor={`${formId}-name`}>Nombre *</Label>
          <Input
            id={`${formId}-name`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
            placeholder="Mi sitio corporativo"
            maxLength={120}
            required
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${formId}-name-error` : undefined}
          />
          {nameError ? (
            <p id={`${formId}-name-error`} className="mt-1 text-xs text-danger" role="alert">
              {nameError}
            </p>
          ) : null}
        </div>

        <div>
          <Label htmlFor={`${formId}-desc`}>Descripción</Label>
          <Textarea
            id={`${formId}-desc`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Qué ofrece este sitio, a quién va dirigido…"
            maxLength={500}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${formId}-folder`}>Carpeta</Label>
            <Input
              id={`${formId}-folder`}
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              list={`${formId}-folders`}
              placeholder="Clientes / Acme"
            />
            <datalist id={`${formId}-folders`}>
              {folderSuggestions.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>
          <div>
            <Label htmlFor={`${formId}-tags`}>Etiquetas</Label>
            <Input
              id={`${formId}-tags`}
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="landing, seo, corporativo"
            />
          </div>
        </div>

        <fieldset>
          <legend className="mb-1 text-xs font-medium text-ink-muted">Tecnología inicial</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {STACK_OPTIONS.map((option) => (
              <label
                key={option.id}
                className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-sm ${
                  stack === option.id
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface hover:bg-surface-muted"
                }`}
              >
                <span className="flex items-center gap-2 font-medium text-ink">
                  <input
                    type="radio"
                    name={`${formId}-stack`}
                    className="sr-only"
                    value={option.id}
                    checked={stack === option.id}
                    onChange={() => setStack(option.id)}
                  />
                  {option.label}
                </span>
                <span className="text-xs text-ink-muted">{option.description}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Guardando…" : project ? "Guardar cambios" : "Crear proyecto"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
