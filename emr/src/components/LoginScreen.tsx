import { useState } from 'react'
import { Cross, Lock } from 'lucide-react'
import { useEMR } from '../state/EMRContext'

/** 병원 EMR 로그인 화면. 비밀번호 확인은 서버가 한다(성공하면 세션 쿠키 발급). */
export default function LoginScreen() {
  const { user, login } = useEMR()
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!pw || busy) return
    setBusy(true)
    const msg = await login(pw)
    setBusy(false)
    if (msg) { setErr(msg); setPw('') }
  }

  return (
    <div className="emr-root flex h-screen w-screen items-center justify-center" style={{ background: 'radial-gradient(ellipse at 50% 35%, #26344f 0%, #141c2b 70%)' }}>
      <div className="win-frame w-[380px]">
        <div className="title-blue flex h-[24px] items-center gap-1.5 px-2 text-[12px] font-bold"><Lock size={12} /> 익명대학교병원 EMR 로그인</div>
        <form className="space-y-3 bg-emr-panel p-5" onSubmit={submit}>
          <div className="flex items-center gap-2.5">
            <span className="flex h-[34px] w-[34px] items-center justify-center border border-[#7a1010] bg-gradient-to-b from-[#ff6a5e] to-[#c0261b] text-white"><Cross size={22} strokeWidth={3} /></span>
            <div className="leading-tight">
              <div className="text-[15px] font-extrabold text-white">익명대학교병원</div>
              <div className="text-[9px] tracking-[0.18em] text-emr-sub">ANONYMOUS UNIV. HOSPITAL · EMR</div>
            </div>
          </div>
          <label className="block text-[11px] text-emr-sub">사용자
            <input className="inp mt-0.5 w-full" value={`${user.name} ${user.title} (${user.dept})`} readOnly />
          </label>
          <label className="block text-[11px] text-emr-sub">비밀번호
            <input className="inp mt-0.5 w-full" type="password" autoFocus autoComplete="current-password" value={pw} onChange={(e) => { setPw(e.target.value); setErr('') }} placeholder="비밀번호를 입력하세요" />
          </label>
          <div className="min-h-[16px] text-[11px] text-emr-bad" role="alert">{err}</div>
          <button type="submit" className="btn btn-blue h-[26px] w-full justify-center text-[12px]" disabled={!pw || busy}>{busy ? '확인 중…' : '로그인'}</button>
          <div className="border-t border-black/40 pt-2 text-[10px] leading-[1.5] text-emr-sub">허가된 사용자만 접근할 수 있습니다. 이 시스템의 환자 자료는 비식별 데이터와 가상 데이터입니다.</div>
        </form>
      </div>
    </div>
  )
}
