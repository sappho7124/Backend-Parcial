export class TwilioService {
  static async sendDeliveryPin(phoneNumber: string | null | undefined, orderId: string, pin: string) {
    if (!phoneNumber) {
      return { sent: false, reason: "Usuario sin teléfono registrado" };
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    const messageBody = `SwiftDrop: Tu pedido #${orderId.slice(0, 8)} va en camino. Tu PIN de entrega es: ${pin}`;

    // Si no hay credenciales reales configuradas, opera en modo simulado sin fallar
    if (!accountSid || !authToken || !fromNumber || process.env.SMS_PROVIDER === "mock") {
      console.info(`[TWILIO MOCK] To: ${phoneNumber} | Msg: ${messageBody}`);
      return { sent: true, mock: true, to: phoneNumber, pin };
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const body = new URLSearchParams({
      To: phoneNumber,
      From: fromNumber,
      Body: messageBody,
    });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Twilio error (${res.status}): ${errText}`);
    }

    return { sent: true, mock: false, to: phoneNumber };
  }
}