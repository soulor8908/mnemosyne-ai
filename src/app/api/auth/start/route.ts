// 登录/注册第一步：登记用户（首次）并签发一次性挑战
// 免鉴权入口（这是登录过程本身）。
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { registerOrGetUser, issueChallenge } from '@/lib/auth/zerotrust';

const StartSchema = z.object({
  // userId = H(masterKey)，客户端派生，服务端只见此标识
  userId: z.string().min(16).max(128),
  // verifier = H(masterKey|salt)，仅首次注册时存储；已存在则忽略
  verifier: z.string().min(16).max(128),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, verifier } = StartSchema.parse(body);

    // 首次自动注册（userId 高熵，抢注无意义）；已存在则仅签发挑战
    await registerOrGetUser(userId, verifier);
    const challenge = await issueChallenge(userId);

    return NextResponse.json({ ok: true, challenge });
  } catch (err) {
    const status = err instanceof z.ZodError ? 400 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'login start failed' },
      { status }
    );
  }
}
