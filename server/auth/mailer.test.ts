import { describe, expect, it } from "vitest";
import { buildMail, mailTransportFrom } from "./mailer.ts";

describe("buildMail", () => {
  it("arma texto y HTML con el enlace absoluto y escapa lo que llega", () => {
    const mail = buildMail({
      recipient: "ana@dominio.dev",
      subject: "Confirma tu correo",
      body: 'Entra en el enlace <b>"ya"</b>',
      actionUrl: "/verificar-correo?token=abc",
      publicUrl: "https://app.dominio.dev"
    });
    expect(mail.text).toContain("https://app.dominio.dev/verificar-correo?token=abc");
    expect(mail.html).toContain('href="https://app.dominio.dev/verificar-correo?token=abc"');
    expect(mail.html).toContain('&lt;b&gt;"ya"&lt;/b&gt;');
    expect(mail.html).not.toContain("<b>");
  });
});

describe("mailTransportFrom", () => {
  it("sin configuración no hay transporte: nadie finge enviar", () => {
    expect(mailTransportFrom(null)).toBeNull();
  });
});
