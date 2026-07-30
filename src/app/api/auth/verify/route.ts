// 登录第二步：校验挑战应答并签发会话令牌
// 免鉴权入口（这是登录过程本身）。
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { consumeChallenge, verifyLogin } from '@/lib/auth/zerotrust';

const VerifySchema = z.object({
  userId: z.string().min(16).max(128),
  challenge: z.string().min(16).max(128),
  // response = H(verifier | challenge)，证明掌握 masterKey 而不传递它
  response: z.string().min(16).max(128),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, challenge, response } = VerifySchema.parse(body);

    // 取出并消费挑战（一次性，防重放）
    const stored = await consumeChallenge(userId);
    if (!stored || stored !== challenge) {
      return NextResponse.json(
        { error: '挑战已失效，请重新登录' },
        { status: 400 }
      );
    }

    const sessionId = await verifyLogin(userId, challenge, response);
    if (!sessionId) {
      return NextResponse.json({ error: '验证失败：助记词/主密钥不匹配' }, { status: 401 });
    }

    return NextResponse.json({ ok: true, sessionId });
  } catch (err) {
    const status = err instanceof z.ZodError ? 400 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'login verify failed' },
      { status }
    );
  }
}
