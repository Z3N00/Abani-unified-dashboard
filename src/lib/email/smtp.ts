import 'server-only'

import nodemailer from 'nodemailer'

function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not configured.`)
  return value
}

export async function sendQueuedEmail(message: { to: string; subject: string; html: string }) {
  const port = Number(process.env.SMTP_PORT || 465)
  const transporter = nodemailer.createTransport({
    host: required('SMTP_HOST'),
    port,
    secure: port === 465,
    auth: {
      user: required('SMTP_USER'),
      pass: required('SMTP_PASSWORD'),
    },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  })
  const result = await transporter.sendMail({
    from: process.env.SMTP_FROM?.trim() || required('SMTP_USER'),
    to: message.to,
    subject: message.subject,
    html: message.html,
  })
  if (!result.accepted.map(String).includes(message.to)) throw new Error(`SMTP did not accept ${message.to}.`)
  return { messageId: result.messageId, accepted: result.accepted.map(String) }
}
