import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import nodemailer, { type Transporter } from "nodemailer";
import type { Env } from "./env.js";
import type { Logger } from "./logger.js";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(email: Email): Promise<void>;
}

/** Collects emails instead of sending them; tests read them back. */
export class InMemoryMailer implements Mailer {
  readonly sent: Email[] = [];
  send(email: Email): Promise<void> {
    this.sent.push(email);
    return Promise.resolve();
  }
  /** Last email sent to `to`, or undefined. */
  lastTo(to: string): Email | undefined {
    return [...this.sent].reverse().find((e) => e.to === to);
  }
}

class TransporterMailer implements Mailer {
  constructor(
    private readonly transporter: Transporter,
    private readonly from: string,
  ) {}
  async send(email: Email): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...email });
  }
}

class LogMailer implements Mailer {
  constructor(private readonly logger: Logger) {}
  send(email: Email): Promise<void> {
    this.logger.info(
      { to: email.to, subject: email.subject, text: email.text },
      "email (not sent)",
    );
    return Promise.resolve();
  }
}

export function createMailer(env: Env, logger: Logger): Mailer {
  switch (env.EMAIL_TRANSPORT) {
    case "smtp":
      return new TransporterMailer(nodemailer.createTransport(env.SMTP_URL), env.EMAIL_FROM);
    case "ses": {
      const ses = new SESv2Client(env.AWS_REGION ? { region: env.AWS_REGION } : {});
      return new TransporterMailer(
        nodemailer.createTransport({ SES: { sesClient: ses, SendEmailCommand } }),
        env.EMAIL_FROM,
      );
    }
    case "log":
      return new LogMailer(logger);
  }
}
