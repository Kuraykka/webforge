import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Compass } from "lucide-react";

export function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass className="h-8 w-8" aria-hidden />}
      title="Página no encontrada (404)"
      description="La ruta solicitada no existe en la plataforma."
      action={
        <Link to="/">
          <Button variant="primary">Volver al panel</Button>
        </Link>
      }
    />
  );
}
