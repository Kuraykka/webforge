import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../db.ts";
import { deliverMessage, deliverPending, listOutbox, queueMessage } from "./outbox.ts";
import type { OutgoingMail } from "./mailer.ts";

function fixture() {
  const db = openDatabase(":memory:");
  migrate(db);
  const id = queueMessage(db, {
    recipient: "ana@dominio.dev",
    subject: "Confirma tu correo",
    body: "Entra en el enlace",
    actionUrl: "/verificar-correo?token=abc"
  });
  return { db, id };
}

describe("entrega del outbox", () => {
  it("con transporte marca el mensaje como enviado y no lo repite", async () => {
    const { db, id } = fixture();
    const enviados: OutgoingMail[] = [];
    const transport = { send: async (mail: OutgoingMail) => void enviados.push(mail) };

    expect(await deliverMessage(db, id, transport, "https://app.dev")).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]?.text).toContain("https://app.dev/verificar-correo?token=abc");
    expect(listOutbox(db, 10)[0]?.sentAt).toBeTypeOf("string");
    expect(listOutbox(db, 10)[0]?.error).toBeNull();

    expect(await deliverMessage(db, id, transport, "https://app.dev")).toBe(true);
    expect(enviados).toHaveLength(1);
    db.close();
  });

  it("si el proveedor falla queda pendiente, con el error anotado", async () => {
    const { db, id } = fixture();
    const transport = {
      send: async () => {
        throw new Error("SMTP caído");
      }
    };
    expect(await deliverMessage(db, id, transport, "https://app.dev")).toBe(false);
    const [mensaje] = listOutbox(db, 10);
    expect(mensaje?.sentAt).toBeNull();
    expect(mensaje?.attemptedAt).toBeTypeOf("string");
    expect(mensaje?.error).toBe("SMTP caído");
    db.close();
  });

  it("deliverPending cuenta entregados y fallidos", async () => {
    const { db } = fixture();
    queueMessage(db, { recipient: "otro@dominio.dev", subject: "Hola", body: "x", actionUrl: "/x" });
    const transport = {
      send: async (mail: OutgoingMail) => {
        if (mail.to === "otro@dominio.dev") throw new Error("rebotado");
      }
    };
    expect(await deliverPending(db, transport, "https://app.dev")).toEqual({ entregados: 1, fallidos: 1 });
    db.close();
  });
});
