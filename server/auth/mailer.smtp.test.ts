import { SMTPServer } from "smtp-server";
import { describe, expect, it } from "vitest";
import { buildMail, mailTransportFrom } from "./mailer.ts";

/**
 * Prueba de verdad: nodemailer habla SMTP contra un servidor local y el mensaje llega.
 * No sustituye a configurar un proveedor real, pero demuestra que el envío no es una simulación.
 */
describe("transporte SMTP", () => {
  it("entrega el mensaje a un servidor SMTP real", async () => {
    const recibidos: string[] = [];
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS"],
      onData(stream, _session, callback) {
        let crudo = "";
        stream.on("data", (trozo: Buffer) => {
          crudo += trozo.toString("utf8");
        });
        stream.on("end", () => {
          recibidos.push(crudo);
          callback();
        });
      }
    });
    server.on("error", () => undefined);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const direccion = server.server.address();
    const puerto = typeof direccion === "object" && direccion !== null ? direccion.port : 0;

    try {
      const transport = mailTransportFrom({ url: `smtp://127.0.0.1:${puerto}`, from: "WebForge <no-reply@dominio.dev>" });
      expect(transport).not.toBeNull();
      await transport?.send(
        buildMail({
          recipient: "ana@dominio.dev",
          subject: "Confirma tu correo",
          body: "Entra en el enlace",
          actionUrl: "/verificar-correo?token=abc",
          publicUrl: "https://app.dominio.dev"
        })
      );
      expect(recibidos).toHaveLength(1);
      expect(recibidos[0]).toContain("To: ana@dominio.dev");
      expect(recibidos[0]).toContain("Subject: Confirma tu correo");
      expect(recibidos[0]).toContain("https://app.dominio.dev/verificar-correo?token=abc");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);
});
