import { Client, Env } from "../types";

export async function sendEmailValidation(
  env: Env,
  client: Client,
  to: string,
  code: string,
) {
  const message = `Here is the code to validate your email: ${code}`;
  await env.sendEmail({
    to: [{ email: to, name: to }],
    from: {
      email: client.senderEmail,
      name: client.senderName,
    },
    content: [
      {
        type: "text/plain",
        value: message,
      },
    ],
    subject: "Validate email",
  });
}

export async function sendResetPassword(
  env: Env,
  client: Client,
  to: string,
  code: string,
) {
  const message = `Click this link to reset your password: ${env.ISSUER}u/reset-password?state=${state}&code=${code}`;
  await env.sendEmail({
    to: [{ email: to, name: to }],
    from: {
      email: client.senderEmail,
      name: client.senderName,
    },
    content: [
      {
        type: "text/plain",
        value: message,
      },
    ],
    subject: "Reset password",
  });
}
