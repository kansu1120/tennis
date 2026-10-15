import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, CalendarDays, Check,
  ChevronDown, ChevronLeft, ChevronRight, ClipboardList,
  Plus, Save, ShieldCheck, Sparkles, Trash2, Trophy, Users, X
} from 'lucide-react'
import './ranking.css'
import { isCloudConfigured, loadSharedState, saveSharedRecords, subscribeToSharedRecords, type SharedRecord } from './sharedData'

type Member = { id: string; name: string; nickname: string; points: number; pointAdjustment?: number; wins: number; losses: number; color: string }
type Surface = 'ハード' | 'クレー' | 'オムニ'
type GameRecord = { server: string; winner: string }
type Match = { id: string; round: string; a: string; b: string; scoreA: number | null; scoreB: number | null; winner: string | null; surface?: Surface; gameLog?: GameRecord[] }
type Tournament = { id: string; name: string; date: string; status: '開催中' | '終了' | '準備中'; format: string; participants: number; participantIds?: string[]; points: Record<string, number>; matches: Match[]; expiryDays: number | null; manualDraw?: boolean; awardedPoints?: Record<string, number> }
type Notice = { id: number; message: string; time: string }

function stableSerialize(value: unknown): string | undefined {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => stableSerialize(item)))
  if (value && typeof value === 'object') {
    return JSON.stringify(Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableSerialize(item)])
    ))
  }
  return JSON.stringify(value)
}

function describeCloudError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const detail = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    return [detail.message, detail.details, detail.hint, detail.code]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' — ') || JSON.stringify(error)
  }
  return String(error)
}

function getTournamentStandings(tournament: Tournament, matches: Match[]) {
  if (tournament.format === 'リーグ') {
    const participants = tournament.participantIds ??
      [...new Set(matches.flatMap(match => [match.a, match.b]).filter(Boolean))]
    const standings = participants.map(memberId => {
      const played = matches.filter(match => match.winner && (match.a === memberId || match.b === memberId))
      const wins = played.filter(match => match.winner === memberId).length
      return { memberId, wins, losses: played.length - wins, place: 0 }
    }).sort((a, b) => b.wins - a.wins)
    let place = 0
    let previousWins: number | undefined
    standings.forEach((standing, index) => {
      if (standing.wins !== previousWins) place = index + 1
      standing.place = place
      previousWins = standing.wins
    })
    return standings
  }

  const rounds = [...new Set(matches.map(match => match.round))]
  if (!rounds.length) return []
  let advancing: (string | null)[] = matches
    .filter(match => match.round === rounds[0])
    .flatMap(match => [match.a || null, match.b || null])
  const standings: { memberId: string; wins: number; losses: number; place: number }[] = []

  rounds.forEach((round, roundIndex) => {
    const roundMatches = matches.filter(match => match.round === round)
    const nextAdvancing: (string | null)[] = []
    roundMatches.forEach((match, index) => {
      const a = roundIndex === 0 ? match.a || null : advancing[index * 2] ?? null
      const b = roundIndex === 0 ? match.b || null : advancing[index * 2 + 1] ?? null
      if (a && !b) {
        nextAdvancing.push(a)
      } else if (!a && b) {
        nextAdvancing.push(b)
      } else if (a && b && match.a === a && match.b === b &&
        match.scoreA !== null && match.scoreB !== null &&
        (match.winner === a || match.winner === b)) {
        nextAdvancing.push(match.winner)
        standings.push({ memberId: match.winner === a ? b : a, wins: 0, losses: 0, place: 0 })
      } else {
        nextAdvancing.push(null)
      }
    })
    const eliminated = standings.filter(standing => standing.place === 0)
    const roundPlace = nextAdvancing.filter(Boolean).length + 1
    eliminated.forEach(standing => { standing.place = roundPlace })
    advancing = nextAdvancing
  })

  const champion = advancing.find(Boolean)
  if (champion) standings.push({ memberId: champion, wins: 0, losses: 0, place: 1 })
  return standings.sort((a, b) => a.place - b.place)
}

function isTournamentComplete(tournament: Tournament, matches: Match[]) {
  if (tournament.format === 'リーグ') {
    return matches.length > 0 && matches.every(match =>
      match.winner !== null && match.scoreA !== null && match.scoreB !== null
    )
  }

  const rounds = [...new Set(matches.map(match => match.round))]
  const finalRound = rounds[rounds.length - 1]
  const finalMatch = matches.filter(match => match.round === finalRound).slice(-1)[0]
  return Boolean(
    finalMatch?.a &&
    finalMatch.b &&
    finalMatch.scoreA !== null &&
    finalMatch.scoreB !== null &&
    (finalMatch.winner === finalMatch.a || finalMatch.winner === finalMatch.b)
  )
}

const initialMembers: Member[] = [
  { id: 'm1', name: '佐藤 悠真', nickname: 'YUMA', points: 420, wins: 18, losses: 6, color: '#e9c6a5' },
  { id: 'm2', name: '田中 蓮', nickname: 'REN', points: 380, wins: 16, losses: 8, color: '#c4d9cc' },
  { id: 'm3', name: '鈴木 湊', nickname: 'MINATO', points: 340, wins: 14, losses: 7, color: '#d2c9ed' },
  { id: 'm4', name: '高橋 葵', nickname: 'AOI', points: 290, wins: 12, losses: 9, color: '#e8c4c8' },
  { id: 'm5', name: '伊藤 大和', nickname: 'YAMATO', points: 250, wins: 11, losses: 10, color: '#c4d6ed' },
  { id: 'm6', name: '渡辺 陽向', nickname: 'HINATA', points: 210, wins: 9, losses: 11, color: '#e7dba7' },
  { id: 'm7', name: '山本 結翔', nickname: 'YUITO', points: 170, wins: 8, losses: 12, color: '#c8d6d1' },
  { id: 'm8', name: '中村 颯太', nickname: 'SOTA', points: 130, wins: 6, losses: 13, color: '#e9c9aa' },
  { id: 'm9', name: '小林 陸', nickname: 'RIKU', points: 90, wins: 5, losses: 15, color: '#cfc9e7' },
  { id: 'm10', name: '加藤 樹', nickname: 'ITSUKI', points: 60, wins: 3, losses: 16, color: '#e7c8c6' },
]
const initialTournaments: Tournament[] = [
  { id: 't1', name: 'Autumn Cup #04', date: '2026-10-12', status: '開催中', format: 'ノックアウト', participants: 8, points: { '優勝': 100, '準優勝': 70, 'ベスト4': 40, 'ベスト8': 20 }, expiryDays: null,
    matches: [
      { id: 'a', round: '準々決勝', a: 'm1', b: 'm8', scoreA: 6, scoreB: 2, winner: 'm1' },
      { id: 'b', round: '準々決勝', a: 'm4', b: 'm5', scoreA: 4, scoreB: 6, winner: 'm5' },
      { id: 'c', round: '準々決勝', a: 'm2', b: 'm7', scoreA: null, scoreB: null, winner: null },
      { id: 'd', round: '準々決勝', a: 'm3', b: 'm6', scoreA: null, scoreB: null, winner: null },
      { id: 'e', round: '準決勝', a: 'm1', b: 'm5', scoreA: null, scoreB: null, winner: null },
      { id: 'f', round: '準決勝', a: 'm2', b: 'm3', scoreA: null, scoreB: null, winner: null },
      { id: 'g', round: '決勝', a: 'm1', b: 'm2', scoreA: null, scoreB: null, winner: null },
    ] },
  { id: 't2', name: 'Wednesday Rally', date: '2026-10-08', status: '終了', format: 'ノックアウト', participants: 8, points: { '優勝': 80, '準優勝': 50, 'ベスト4': 30, 'ベスト8': 10 }, expiryDays: null,
    matches: [] },
  { id: 't3', name: 'Club Challenge #12', date: '2026-10-18', status: '準備中', format: 'ノックアウト', participants: 10, points: { '優勝': 100, '準優勝': 70, 'ベスト4': 40, 'ベスト8': 20 }, expiryDays: null,
    matches: [] },
]
const fmt = (n: number) => n.toLocaleString('ja-JP')
const surfaceOptions: Surface[] = ['ハード', 'クレー', 'オムニ']

function App() {
  const [members, setMembers] = useState<Member[]>(() => {
    try { const raw = localStorage.getItem('court-members'); return raw ? JSON.parse(raw) as Member[] : initialMembers } catch { return initialMembers }
  })
  const [tournaments, setTournaments] = useState<Tournament[]>(() => {
    try { const raw = localStorage.getItem('court-tournaments'); return raw ? JSON.parse(raw) as Tournament[] : initialTournaments } catch { return initialTournaments }
  })
  const [activeTab, setActiveTab] = useState('ranking')
  const [selectedTournament, setSelectedTournament] = useState('t1')
  const [showNewTournament, setShowNewTournament] = useState(false)
  const [showNewMember, setShowNewMember] = useState(false)
  const [showResult, setShowResult] = useState<Match | null>(null)
  const [showPointsEditor, setShowPointsEditor] = useState(false)
  const [pointsDraft, setPointsDraft] = useState('')
  const [showAdminPin, setShowAdminPin] = useState(false)
  const [adminPin, setAdminPin] = useState('')
  const [pendingAdminAction, setPendingAdminAction] = useState<(() => void) | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [newName, setNewName] = useState('')
  const [newDate, setNewDate] = useState('2026-10-20')
  const [newFormat, setNewFormat] = useState<'ノックアウト' | 'リーグ'>('ノックアウト')
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>(() => members.map(member => member.id))
  const [newMemberName, setNewMemberName] = useState('')
  const [scoreA, setScoreA] = useState('6')
  const [scoreB, setScoreB] = useState('4')
  const [surface, setSurface] = useState<Surface | ''>('')
  const [gameLogEnabled, setGameLogEnabled] = useState(false)
  const [gameLog, setGameLog] = useState<GameRecord[]>([])
  const [firstServer, setFirstServer] = useState('')
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [cloudStatus, setCloudStatus] = useState<'loading' | 'connected' | 'local' | 'error'>(isCloudConfigured ? 'loading' : 'local')
  const [cloudError, setCloudError] = useState('')
  const lastSyncedState = useRef<{ members: Member[]; tournaments: Tournament[] } | null>(null)
  const currentState = useRef({ members, tournaments })
  const applyingRemoteChange = useRef(false)
  currentState.current = { members, tournaments }

  useEffect(() => { localStorage.setItem('court-members', JSON.stringify(members)) }, [members])
  useEffect(() => { localStorage.setItem('court-tournaments', JSON.stringify(tournaments)) }, [tournaments])
  useEffect(() => {
    if (!isCloudConfigured) return
    let cancelled = false
    let unsubscribe = () => {}
    void loadSharedState({ members, tournaments }).then(shared => {
      if (cancelled) return
      const sharedMembers = shared.members as Member[]
      const sharedTournaments = shared.tournaments as Tournament[]
      lastSyncedState.current = { members: sharedMembers, tournaments: sharedTournaments }
      applyingRemoteChange.current = true
      setMembers(sharedMembers)
      setTournaments(sharedTournaments)
      setCloudStatus('connected')
      setCloudError('')
      unsubscribe = subscribeToSharedRecords(record => {
        const state = currentState.current
        const currentRecords = record.kind === 'member' ? state.members : state.tournaments
        const currentRecord = currentRecords.find(item => item.id === record.id)
        const nextRecord = record.deleted ? undefined : record.data
        if (stableSerialize(currentRecord) === stableSerialize(nextRecord)) return
        applyingRemoteChange.current = true
        if (record.kind === 'member') {
          setMembers(previous => record.deleted
            ? previous.filter(item => item.id !== record.id)
            : previous.some(item => item.id === record.id)
              ? previous.map(item => item.id === record.id ? record.data as Member : item)
              : [...previous, record.data as Member])
        } else {
          setTournaments(previous => record.deleted
            ? previous.filter(item => item.id !== record.id)
            : previous.some(item => item.id === record.id)
              ? previous.map(item => item.id === record.id ? record.data as Tournament : item)
              : [...previous, record.data as Tournament])
        }
      })
    }).catch(error => {
      if (cancelled) return
      setCloudStatus('error')
      setCloudError(describeCloudError(error))
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  // Cloud initialization must use the local snapshot only once on first mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!isCloudConfigured || cloudStatus === 'loading' || cloudStatus === 'local') return
    const previous = lastSyncedState.current
    if (!previous) {
      lastSyncedState.current = { members, tournaments }
      return
    }
    if (applyingRemoteChange.current) {
      applyingRemoteChange.current = false
      lastSyncedState.current = { members, tournaments }
      return
    }
    const records: SharedRecord[] = []
    const collectChanges = <T extends { id: string }>(before: T[], after: T[], kind: SharedRecord['kind']) => {
      const oldById = new Map(before.map(record => [record.id, record]))
      const nextById = new Map(after.map(record => [record.id, record]))
      after.forEach(record => {
        if (stableSerialize(oldById.get(record.id)) !== stableSerialize(record)) {
          records.push({ id: record.id, kind, data: record, deleted: false })
        }
      })
      before.forEach(record => {
        if (!nextById.has(record.id)) records.push({ id: record.id, kind, data: null, deleted: true })
      })
    }
    collectChanges(previous.members, members, 'member')
    collectChanges(previous.tournaments, tournaments, 'tournament')
    lastSyncedState.current = { members, tournaments }
    if (!records.length) return
    void saveSharedRecords(records).then(() => {
      setCloudStatus('connected')
      setCloudError('')
    }).catch(error => {
      setCloudStatus('error')
      setCloudError(describeCloudError(error))
    })
  }, [members, tournaments, cloudStatus])
  const ranked = useMemo(() => members.map(member => {
    const totals = tournaments.reduce((current, tournament) => {
      const awarded = tournament.awardedPoints?.[member.id] ?? 0
      const expiryTime = tournament.expiryDays === null
        ? Number.POSITIVE_INFINITY
        : new Date(`${tournament.date}T00:00:00`).getTime() + tournament.expiryDays * 86400000
      return {
        all: current.all + awarded,
        active: current.active + (Date.now() <= expiryTime ? awarded : 0),
      }
    }, { all: 0, active: 0 })
    return { ...member, points: Math.max(0, member.points + (member.pointAdjustment ?? 0) - totals.all + totals.active) }
  }).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'ja')), [members, tournaments])
  const activeTournament = tournaments.find(t => t.id === selectedTournament) ?? tournaments[0]
  const showNotice = (message: string) => {
    const item = { id: Date.now(), message, time: 'たった今' }
    setNotice(item)
    window.setTimeout(() => setNotice(current => current?.id === item.id ? null : current), 3200)
  }
  const requestAdminAccess = (action: () => void) => {
    setPendingAdminAction(() => action)
    setAdminPin('')
    setShowAdminPin(true)
  }
  const confirmAdminPin = () => {
    if (adminPin !== '0000') {
      showNotice('PINが正しくありません')
      return
    }
    const action = pendingAdminAction
    setPendingAdminAction(null)
    setShowAdminPin(false)
    setAdminPin('')
    action?.()
  }
  const getMember = (id: string) => members.find(m => m.id === id)
  const rankFor = (member: Member) => 1 + ranked.filter(m => m.points > member.points).length
  const openPointsEditor = (memberId: string) => {
    requestAdminAccess(() => {
      const current = ranked.find(item => item.id === memberId)
      if (!current) {
        showNotice('部員が見つかりません')
        return
      }
      setPointsDraft(String(current.points))
      setShowPointsEditor(true)
    })
  }
  const saveMemberPoints = () => {
    if (!selectedMember) return
    const points = Number(pointsDraft)
    if (!Number.isInteger(points) || points < 0) {
      showNotice('ポイントは0以上の整数を入力してください')
      return
    }
    const current = ranked.find(item => item.id === selectedMember.id)
    if (!current) {
      showNotice('部員が見つかりません')
      setShowPointsEditor(false)
      return
    }
    const difference = points - current.points
    setMembers(prev => prev.map(member => member.id === selectedMember.id
      ? { ...member, pointAdjustment: (member.pointAdjustment ?? 0) + difference }
      : member
    ))
    setShowPointsEditor(false)
    showNotice(`${selectedMember.name}さんのポイントを更新しました`)
  }
  const addMember = () => {
    const name = newMemberName.trim()
    if (!name) return
    const member: Member = { id: `m${Date.now()}`, name, nickname: name.replace(/\s/g, '').toUpperCase().slice(0, 12), points: 0, wins: 0, losses: 0, color: '#d4e4d8' }
    setMembers(prev => [...prev, member]); setNewMemberName(''); setShowNewMember(false); showNotice(`${name}さんを部員に追加しました`)
  }
  const deleteMember = (member: Member) => {
    requestAdminAccess(() => {
      if (!window.confirm(`${member.name}さんを部員一覧から削除しますか？`)) return
      setMembers(prev => prev.filter(item => item.id !== member.id))
      setSelectedParticipantIds(prev => prev.filter(id => id !== member.id))
      setSelectedMember(current => current?.id === member.id ? null : current)
      setTournaments(prev => prev.map(tournament =>
        tournament.matches.length === 0
          ? { ...tournament, participantIds: tournament.participantIds?.filter(id => id !== member.id), participants: tournament.participantIds?.filter(id => id !== member.id).length ?? tournament.participants }
          : tournament
      ))
      showNotice(`${member.name}さんを削除しました`)
    })
  }
  const deleteTournament = (tournament: Tournament) => {
    requestAdminAccess(() => {
      if (!window.confirm(`試合「${tournament.name}」とその試合記録を削除しますか？`)) return
      setMembers(prev => prev.map(member => {
        let wins = member.wins
        let losses = member.losses
        tournament.matches.forEach(match => {
          if (!match.winner || match.scoreA === null || match.scoreB === null) return
          if (match.winner === member.id) wins--
          else if (match.a === member.id || match.b === member.id) losses--
        })
        return { ...member, points: Math.max(0, member.points - (tournament.awardedPoints?.[member.id] ?? 0)), wins: Math.max(0, wins), losses: Math.max(0, losses) }
      }))
      const remaining = tournaments.filter(item => item.id !== tournament.id)
      setTournaments(remaining)
      setSelectedTournament(remaining[0]?.id ?? '')
      showNotice(`試合「${tournament.name}」を削除しました`)
    })
  }
  const saveTournamentAwards = (tournamentId: string, awards: Record<string, number>, expiryDays: number | null) => {
    const tournament = tournaments.find(item => item.id === tournamentId)
    if (!tournament) return
    const previousAwards = tournament.awardedPoints ?? {}
    setMembers(prev => prev.map(member => ({
      ...member,
      points: Math.max(0, member.points - (previousAwards[member.id] ?? 0) + (awards[member.id] ?? 0)),
    })))
    setTournaments(prev => prev.map(item => item.id === tournamentId
      ? { ...item, awardedPoints: awards, expiryDays }
      : item
    ))
    showNotice('試合結果と獲得ポイントを保存しました')
  }
  const saveTournamentInfo = (tournamentId: string, info: { name: string; date: string; format: string; participantIds: string[] }) => {
    setTournaments(prev => prev.map(tournament => tournament.id === tournamentId
      ? {
        ...tournament,
        name: info.name,
        date: info.date,
        ...(tournament.matches.length === 0 ? {
          format: info.format,
          participantIds: info.participantIds,
          participants: info.participantIds.length,
        } : {}),
      }
      : tournament
    ))
    showNotice('試合情報を更新しました')
  }
  const addTournament = () => {
    if (!newName.trim()) return
    if (selectedParticipantIds.length < 2) {
      showNotice('試合には2人以上の参加者を選択してください')
      return
    }
    const t: Tournament = { id: `t${Date.now()}`, name: newName.trim(), date: newDate, status: '準備中', format: newFormat, participants: selectedParticipantIds.length, participantIds: selectedParticipantIds, points: {}, expiryDays: null, matches: [] }
    setTournaments(prev => [t, ...prev]); setSelectedTournament(t.id); setNewName(''); setNewFormat('ノックアウト'); setSelectedParticipantIds(members.map(member => member.id)); setShowNewTournament(false); setActiveTab('tournaments'); showNotice('試合を作成しました')
  }
  const openNewTournament = () => {
    setSelectedParticipantIds(members.map(member => member.id))
    setShowNewTournament(true)
  }
  const recordResult = () => {
    if (!showResult || !activeTournament) return
    let a = Number(scoreA), b = Number(scoreB)
    if (gameLogEnabled) {
      if (!firstServer || !gameLog.length) {
        showNotice('最初のサーバーを選び、ゲームを記録してください')
        return
      }
      a = gameLog.filter(game => game.winner === showResult.a).length
      b = gameLog.filter(game => game.winner === showResult.b).length
    }
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b) { showNotice('有効なスコアを入力してください（ゲーム数は整数、引き分け不可）'); return }
    const winner = a > b ? showResult.a : showResult.b
    const updated = { ...showResult, scoreA: a, scoreB: b, winner, surface: surface || undefined, gameLog: gameLogEnabled ? gameLog : undefined }
    const prior = showResult.winner
    const tournamentMatches = activeTournament.matches
    const matchRounds = [...new Set(tournamentMatches.map(match => match.round))]
    const currentRoundIndex = matchRounds.indexOf(showResult.round)
    const currentRoundMatches = tournamentMatches.filter(match => match.round === showResult.round)
    let currentMatchIndex = currentRoundMatches.findIndex(match => match.id === showResult.id)
    const downstreamMatches: Match[] = []
    if (activeTournament.format !== 'リーグ' && prior && prior !== winner && currentRoundIndex >= 0 && currentMatchIndex >= 0) {
      for (let roundIndex = currentRoundIndex + 1; roundIndex < matchRounds.length; roundIndex++) {
        currentMatchIndex = Math.floor(currentMatchIndex / 2)
        const downstream = tournamentMatches.filter(match => match.round === matchRounds[roundIndex])[currentMatchIndex]
        if (downstream) downstreamMatches.push(downstream)
      }
    }
    const clearedDownstreamIds = new Set(downstreamMatches.map(match => match.id))
    const nextMatches = tournamentMatches.map(match => {
        if (match.id === updated.id) return updated
        if (!clearedDownstreamIds.has(match.id)) return match
        return { ...match, winner: null, scoreA: null, scoreB: null, surface: undefined, gameLog: undefined }
      })
    const complete = isTournamentComplete(activeTournament, nextMatches)
    const nextStatus = complete ? '終了' : '開催中'
    setTournaments(prev => prev.map(t => t.id === activeTournament.id ? {
      ...t,
      status: nextStatus,
      matches: nextMatches,
    } : t))
    setMembers(prev => prev.map(member => {
      let wins = member.wins
      let losses = member.losses
      const removeRecordedOutcome = (match: Match) => {
        if (!match.winner || match.scoreA === null || match.scoreB === null) return
        if (match.winner === member.id) wins--
        else if (match.a === member.id || match.b === member.id) losses--
      }
      const addRecordedOutcome = (match: Match) => {
        if (match.winner === member.id) wins++
        else if (match.a === member.id || match.b === member.id) losses++
      }
      if (prior !== winner) {
        removeRecordedOutcome(showResult)
        addRecordedOutcome(updated)
        downstreamMatches.forEach(removeRecordedOutcome)
      }
      return { ...member, wins: Math.max(0, wins), losses: Math.max(0, losses) }
    }))
    setShowResult(null); showNotice('試合結果を保存しました')
  }
  const generateBracket = (method: 'automatic' | 'manual' = 'automatic') => {
    if (!activeTournament) return
    const participantIds = activeTournament.participantIds ?? ranked.slice(0, Math.min(activeTournament.participants, ranked.length)).map(member => member.id)
    const pool = participantIds.map(getMember).filter((member): member is Member => member !== undefined)
    if (pool.length < 2) {
      showNotice('対戦表の生成には2人以上の参加者が必要です')
      return
    }
    if (activeTournament.format === 'リーグ') {
      const rotation: (string | null)[] = pool.map(member => member.id)
      if (rotation.length % 2 === 1) rotation.push(null)
      const matches: Match[] = []
      const roundCount = rotation.length - 1
      const matchesPerRound = rotation.length / 2
      for (let round = 0; round < roundCount; round++) {
        for (let matchIndex = 0; matchIndex < matchesPerRound; matchIndex++) {
          const a = rotation[matchIndex]
          const b = rotation[rotation.length - 1 - matchIndex]
          if (!a || !b) continue
          matches.push({
            id: `${activeTournament.id}-league-r${round + 1}-${matchIndex}`,
            round: `第${round + 1}節`,
            a,
            b,
            scoreA: null,
            scoreB: null,
            winner: null,
          })
        }
        const fixed = rotation[0]
        const rest = rotation.slice(1)
        const last = rest.pop()
        if (last !== undefined) rest.unshift(last)
        rotation.splice(0, rotation.length, fixed, ...rest)
      }
      setTournaments(prev => prev.map(t => t.id === activeTournament.id ? { ...t, status: '開催中', matches } : t))
      showNotice('総当たりのリーグ戦を生成しました')
      return
    }
    const size = 2 ** Math.ceil(Math.log2(Math.max(2, pool.length)))
    const drawOrder = pool.map(member => member.id)
    if (method === 'automatic') {
      for (let index = drawOrder.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1))
        ;[drawOrder[index], drawOrder[swapIndex]] = [drawOrder[swapIndex], drawOrder[index]]
      }
    }
    const ids = method === 'manual'
      ? Array.from({ length: size }, () => '')
      : Array.from({ length: size }, (_, i) => drawOrder[i] ?? '')
    const roundCount = Math.log2(size)
    const matches: Match[] = []
    const roundNames = (round: number) => round === roundCount ? '決勝' : round === roundCount - 1 ? '準決勝' : round === roundCount - 2 ? '準々決勝' : `${round - (roundCount - 3)}回戦`
    let prevIds: string[] = []
    for (let r = 1; r <= roundCount; r++) {
      const count = size / (2 ** r)
      const currentIds: string[] = []
      for (let i = 0; i < count; i++) {
        const a = r === 1 ? ids[i * 2] : ''
        const b = r === 1 ? ids[i * 2 + 1] : ''
        const match: Match = { id: `${activeTournament.id}-r${r}-${i}`, round: roundNames(r), a, b, scoreA: null, scoreB: null, winner: a && !b ? a : null }
        matches.push(match); currentIds.push(match.id)
      }
      prevIds = currentIds
    }
    void prevIds
    setTournaments(prev => prev.map(t => t.id === activeTournament.id ? { ...t, status: '開催中', matches, manualDraw: method === 'manual' } : t))
    showNotice(method === 'manual' ? '空の対戦表を作成しました。参加者を配置してください' : 'トーナメントを生成しました。対戦カードを確認してください')
  }
  const confirmManualDraw = () => {
    if (!activeTournament?.manualDraw) return
    const expectedIds = activeTournament.participantIds ??
      ranked.slice(0, activeTournament.participants).map(member => member.id)
    const firstRound = activeTournament.matches.filter(match =>
      match.round === [...new Set(activeTournament.matches.map(item => item.round))][0]
    )
    const assignedIds = firstRound.flatMap(match => [match.a, match.b]).filter(Boolean)
    if (assignedIds.length !== expectedIds.length ||
      new Set(assignedIds).size !== expectedIds.length ||
      expectedIds.some(id => !assignedIds.includes(id))) {
      showNotice('参加者全員を対戦表に1度ずつ配置してください')
      return
    }
    setTournaments(prev => prev.map(t => t.id === activeTournament.id ? { ...t, manualDraw: false } : t))
    showNotice('対戦表を確定しました')
  }
  const editMatch = (match: Match, side: 'a' | 'b', memberId: string) => {
    if (!activeTournament) return
    if (memberId && match[side === 'a' ? 'b' : 'a'] === memberId) {
      showNotice('同じ対戦枠に同じ部員を2回登録できません')
      return
    }
    if (memberId && activeTournament.matches.some(other =>
      other.id !== match.id && other.round === match.round && (other.a === memberId || other.b === memberId)
    )) {
      showNotice('その部員は同じラウンドの別の対戦枠に登録済みです')
      return
    }
    setTournaments(prev => prev.map(t => t.id === activeTournament.id ? { ...t, matches: t.matches.map(m => m.id === match.id ? { ...m, [side]: memberId, winner: null, scoreA: null, scoreB: null, surface: undefined, gameLog: undefined } : m) } : t))
  }
  const openResult = (match: Match) => {
    setShowResult(match)
    setScoreA(String(match.scoreA ?? 6))
    setScoreB(String(match.scoreB ?? 4))
    setSurface(match.surface ?? '')
    setGameLog(match.gameLog ?? [])
    setGameLogEnabled(Boolean(match.gameLog?.length))
    setFirstServer(match.gameLog?.[0]?.server ?? '')
  }
  const recordGame = (outcome: 'キープ' | 'ブレーク') => {
    if (!showResult || !firstServer) return
    const server = gameLog.length % 2 === 0
      ? firstServer
      : firstServer === showResult.a ? showResult.b : showResult.a
    const winner = outcome === 'キープ'
      ? server
      : server === showResult.a ? showResult.b : showResult.a
    setGameLog(prev => [...prev, { server, winner }])
  }
  const nav = [
    { id: 'ranking', label: 'ランキング', icon: Trophy },
    { id: 'tournaments', label: '試合', icon: CalendarDays },
    { id: 'members', label: '人', icon: Users },
  ]
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <nav>{nav.map(item => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${activeTab === item.id ? 'active' : ''}`} onClick={() => { setSelectedMember(null); setActiveTab(item.id) }}><Icon size={18} strokeWidth={1.8} /><span className="nav-mark" aria-hidden="true">{item.label.slice(0, 1)}</span><span className="nav-label-text">{item.label}</span>{item.id === 'tournaments' && <span className="nav-count">{tournaments.length}</span>}</button> })}</nav>
      </aside>
      <main className="main">
        <div className="content">
          {cloudStatus === 'loading' ? <section className="panel cloud-loading">共有データを読み込んでいます。</section> : <>
          {selectedMember ? <MemberProfile member={ranked.find(member => member.id === selectedMember.id) ?? selectedMember} rank={rankFor(ranked.find(member => member.id === selectedMember.id) ?? selectedMember)} tournaments={tournaments} members={members} onBack={() => setSelectedMember(null)} onEditPoints={() => openPointsEditor(selectedMember.id)} /> : <>
            {activeTab === 'ranking' && <Ranking members={ranked} ranked={ranked} onMember={setSelectedMember} />}
            {activeTab === 'members' && <Members members={ranked} onAdd={() => setShowNewMember(true)} onMember={setSelectedMember} onDelete={deleteMember} />}
            {activeTab === 'tournaments' && <TournamentPage tournaments={tournaments} selected={selectedTournament} setSelected={setSelectedTournament} active={activeTournament} members={ranked} onNew={openNewTournament} onGenerate={generateBracket} onConfirmManualDraw={confirmManualDraw} onResult={openResult} onEdit={editMatch} onNotice={showNotice} onDelete={deleteTournament} onSaveAwards={saveTournamentAwards} onSaveInfo={saveTournamentInfo} />}
          </>}
          </>}
        </div>
      </main>
      {notice && <div className="toast"><div className="toast-check"><Check size={15} /></div><span>{notice.message}</span><button onClick={() => setNotice(null)}><X size={15} /></button></div>}
      {showNewTournament && <Modal title="新しい試合" onClose={() => setShowNewTournament(false)}><label className="field-label">試合名</label><input className="field-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="試合名を入力" autoFocus /><label className="field-label">開催日</label><input className="field-input" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} /><label className="field-label">試合形式</label><select className="field-input" value={newFormat} onChange={e => setNewFormat(e.target.value === 'リーグ' ? 'リーグ' : 'ノックアウト')}><option value="ノックアウト">トーナメント</option><option value="リーグ">リーグ（総当たり）</option></select><div className="participant-picker"><div className="participant-picker-heading"><span className="field-label">参加者（{selectedParticipantIds.length}人選択）</span><button type="button" className="participant-select-all" onClick={() => setSelectedParticipantIds(selectedParticipantIds.length === members.length ? [] : members.map(member => member.id))}>{selectedParticipantIds.length === members.length ? '全解除' : '全員選択'}</button></div><div className="participant-picker-list">{ranked.map(member => <label className="participant-option" key={member.id}><input type="checkbox" checked={selectedParticipantIds.includes(member.id)} onChange={e => setSelectedParticipantIds(current => e.target.checked ? [...current, member.id] : current.filter(id => id !== member.id))} /><span>{member.name}</span></label>)}</div></div><div className="modal-actions"><button className="btn-secondary" onClick={() => setShowNewTournament(false)}>キャンセル</button><button className="btn-primary" onClick={addTournament} disabled={!newName.trim() || selectedParticipantIds.length < 2}>試合を作成 <ChevronRight size={15} /></button></div></Modal>}
      {showNewMember && <Modal title="部員を追加" onClose={() => setShowNewMember(false)}><label className="field-label">氏名</label><input className="field-input" value={newMemberName} onChange={e => setNewMemberName(e.target.value)} placeholder="氏名を入力" autoFocus onKeyDown={e => e.key === 'Enter' && requestAdminAccess(addMember)} /><div className="modal-actions"><button className="btn-secondary" onClick={() => setShowNewMember(false)}>キャンセル</button><button className="btn-primary" onClick={() => requestAdminAccess(addMember)} disabled={!newMemberName.trim()}>部員を追加 <ChevronRight size={15} /></button></div></Modal>}
      {showPointsEditor && <Modal title="ポイントを編集" onClose={() => setShowPointsEditor(false)}><label className="field-label" htmlFor="member-points">現在のポイント</label><input id="member-points" className="field-input" type="number" min="0" step="1" value={pointsDraft} onChange={event => setPointsDraft(event.target.value)} autoFocus onKeyDown={event => event.key === 'Enter' && saveMemberPoints()} /><div className="modal-actions"><button className="btn-secondary" onClick={() => setShowPointsEditor(false)}>キャンセル</button><button className="btn-primary" onClick={saveMemberPoints}>保存 <Check size={15} /></button></div></Modal>}
      {showResult && <Modal title="試合結果を入力" onClose={() => setShowResult(null)}>
        <label className="field-label" htmlFor="match-surface">サーフェス（任意）</label>
        <select id="match-surface" className="field-input" value={surface} onChange={e => { const selected = e.target.value; setSurface(surfaceOptions.find(option => option === selected) ?? '') }}>
          <option value="">未設定</option>{surfaceOptions.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
        <label className="game-log-toggle"><input type="checkbox" checked={gameLogEnabled} onChange={e => setGameLogEnabled(e.target.checked)} /> ゲームごとのキープ／ブレークを記録（任意）</label>
        {gameLogEnabled ? <>
          <span className="field-label">第1ゲームのサーバー</span>
          <div className="first-server-options" role="group" aria-label="第1ゲームのサーバー">
            {([showResult.a, showResult.b] as const).map((memberId, index) => <button key={memberId} type="button" className={`btn-secondary ${firstServer === memberId ? 'selected' : ''}`} aria-pressed={firstServer === memberId} disabled={gameLog.length > 0} onClick={() => setFirstServer(memberId)}>{getMember(memberId)?.name ?? `選手${index === 0 ? 'A' : 'B'}`}</button>)}
          </div>
          <div className="game-log-editor">
            {firstServer && <div className="current-game-server"><strong>第{gameLog.length + 1}ゲーム</strong><span>サーバー：{getMember(gameLog.length % 2 === 0 ? firstServer : firstServer === showResult.a ? showResult.b : showResult.a)?.name ?? '未設定'}</span></div>}
            {firstServer && <div className="game-outcome-buttons"><button className="btn-secondary" onClick={() => recordGame('キープ')}>キープ</button><button className="btn-secondary" onClick={() => recordGame('ブレーク')}>ブレーク</button></div>}
            {gameLog.length > 0 && <div className="game-log-history">{gameLog.map((game, index) => <div key={index}><span>第{index + 1}ゲーム</span><span>{getMember(game.server)?.name}サーブ</span><strong>{game.server === game.winner ? 'キープ' : 'ブレーク'}</strong></div>)}</div>}
            {gameLog.length > 0 && <button className="btn-secondary small game-log-back" onClick={() => setGameLog(prev => prev.slice(0, -1))}>戻る</button>}
          </div>
          <div className="score-inputs"><div><label className="field-label">{getMember(showResult.a)?.name ?? '選手A'}</label><input className="score-field" value={gameLog.filter(game => game.winner === showResult.a).length} readOnly /></div><span className="vs">VS</span><div><label className="field-label">{getMember(showResult.b)?.name ?? '選手B'}</label><input className="score-field" value={gameLog.filter(game => game.winner === showResult.b).length} readOnly /></div></div>
        </> : <div className="score-inputs"><div><label className="field-label">{getMember(showResult.a)?.name ?? '選手A'}</label><input className="score-field" type="number" min="0" step="1" value={scoreA} onChange={e => setScoreA(e.target.value)} /></div><span className="vs">VS</span><div><label className="field-label">{getMember(showResult.b)?.name ?? '選手B'}</label><input className="score-field" type="number" min="0" step="1" value={scoreB} onChange={e => setScoreB(e.target.value)} /></div></div>}
        <div className="modal-actions"><button className="btn-secondary" onClick={() => setShowResult(null)}>キャンセル</button><button className="btn-primary" onClick={recordResult}>結果を保存 <Check size={15} /></button></div>
      </Modal>}
      {showAdminPin && <Modal title="管理者PIN" onClose={() => { setShowAdminPin(false); setPendingAdminAction(null); setAdminPin('') }}><label className="field-label" htmlFor="admin-pin">PIN</label><input id="admin-pin" className="field-input" type="password" inputMode="numeric" maxLength={4} value={adminPin} onChange={e => setAdminPin(e.target.value.replace(/\D/g, '').slice(0, 4))} autoFocus onKeyDown={e => e.key === 'Enter' && confirmAdminPin()} /><div className="modal-note"><ShieldCheck size={16} /> 初期PINは0000です。このPINは画面内の簡易確認用で、ソースやブラウザから回避できるためセキュリティ対策にはなりません。</div><div className="modal-actions"><button className="btn-secondary" onClick={() => { setShowAdminPin(false); setPendingAdminAction(null); setAdminPin('') }}>キャンセル</button><button className="btn-primary" onClick={confirmAdminPin}>続ける <ChevronRight size={15} /></button></div></Modal>}
    </div>
  )
}

function PageHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return <div className="page-heading"><h1>{title}</h1>{action}</div>
}
function Ranking({ members, ranked, onMember }: { members: Member[]; ranked: Member[]; onMember: (m: Member) => void }) {
  return <><PageHeading title="ランキング" />
    <section className="panel ranking-list"><div className="ranking-list-head"><span>順位</span><span>選手</span><span>ポイント</span></div>{members.map(m => { const rank = 1 + ranked.filter(x => x.points > m.points).length; return <button className="ranking-item" key={m.id} onClick={() => onMember(m)}><span className={`ranking-position ${rank <= 3 ? 'top-rank' : ''}`}>{String(rank).padStart(2, '0')}</span><span className="ranking-player"><span><strong>{m.name}</strong></span></span><span className="ranking-points">{fmt(m.points)} <ChevronRight size={16} /></span></button> })}{members.length === 0 && <div className="empty-state">部員がいません。</div>}</section>
  </>
}
function MemberProfile({ member, rank, tournaments, members, onBack, onEditPoints }: { member: Member; rank: number; tournaments: Tournament[]; members: Member[]; onBack: () => void; onEditPoints: () => void }) {
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null)
  const matchHistory = tournaments.flatMap(tournament => tournament.matches
    .filter(match => match.a === member.id || match.b === member.id)
    .map(match => {
      const opponentId = match.a === member.id ? match.b : match.a
      const won = match.winner === member.id
      const result = match.winner ? won ? '勝ち' : '負け' : match.a && match.b ? '未実施' : '相手未定'
      return { tournament, match, opponent: members.find(m => m.id === opponentId), won, result }
    }))
    .sort((a, b) => b.tournament.date.localeCompare(a.tournament.date))
  const total = member.wins + member.losses
  const detailedGames = matchHistory.flatMap(({ match }) => (match.gameLog ?? []).filter(game =>
    (game.server === match.a || game.server === match.b) &&
    (game.winner === match.a || game.winner === match.b)
  ))
  const serviceGames = detailedGames.filter(game => game.server === member.id).length
  const returnGames = detailedGames.length - serviceGames
  const holds = detailedGames.filter(game => game.server === member.id && game.winner === member.id).length
  const breaks = detailedGames.filter(game => game.server !== member.id && game.winner === member.id).length
  const surfaceStats = surfaceOptions.map(surface => {
    const played = matchHistory.filter(item => item.match.surface === surface && item.match.winner)
    return { surface, played: played.length, wins: played.filter(item => item.won).length }
  }).filter(stat => stat.played > 0)
  const pointHistory = tournaments.flatMap(tournament => {
    const points = tournament.awardedPoints?.[member.id]
    if (points === undefined) return []
    const expired = tournament.expiryDays !== null &&
      Date.now() > new Date(`${tournament.date}T00:00:00`).getTime() + tournament.expiryDays * 86400000
    return [{ tournament, points, expired }]
  }).sort((a, b) => b.tournament.date.localeCompare(a.tournament.date))
  return <>
    <PageHeading title={member.name} action={<div className="profile-actions"><button className="btn-secondary" onClick={onEditPoints}>ポイントを編集</button><button className="btn-secondary" onClick={onBack}><ArrowLeft size={15} /> 戻る</button></div>} />
    <section className="panel player-profile">
      <div className="player-profile-summary">
        <div className="player-profile-identity"><strong>#{rank}</strong><span>順位</span></div>
        <div className="player-profile-points"><span>総ポイント</span><strong>{fmt(member.points)}</strong></div>
      </div>
      <div className="player-profile-stats"><div><span>勝利</span><strong>{member.wins}</strong></div><div><span>敗北</span><strong>{member.losses}</strong></div><div><span>勝率</span><strong>{total ? Math.round(member.wins / total * 100) : 0}%</strong></div><div><span>キープ率</span><strong>{serviceGames ? `${Math.round(holds / serviceGames * 100)}% (${holds}/${serviceGames})` : '—'}</strong></div><div><span>ブレーク率</span><strong>{returnGames ? `${Math.round(breaks / returnGames * 100)}% (${breaks}/${returnGames})` : '—'}</strong></div></div>
    </section>
    <section className="panel player-history"><div className="panel-heading"><h3>ポイント獲得履歴</h3></div>{pointHistory.length ? <div className="player-history-list">{pointHistory.map(({ tournament, points, expired }) => <div className="point-history-row" key={tournament.id}><div><strong>{tournament.name}</strong><span>{tournament.date}</span></div><strong className={expired ? 'expired' : ''}>{fmt(points)} pt{expired ? ' · 期限切れ' : ''}</strong></div>)}</div> : <div className="empty-state">ポイント獲得履歴はありません。</div>}</section>
    <section className="panel player-history"><div className="panel-heading"><h3>サーフェス別成績</h3></div>{surfaceStats.length ? <div className="surface-stats">{surfaceStats.map(stat => <div className="surface-stat-row" key={stat.surface}><strong>{stat.surface}</strong><span>{stat.wins}勝 {stat.played - stat.wins}敗</span><span>{Math.round(stat.wins / stat.played * 100)}%</span></div>)}</div> : <div className="empty-state">サーフェスの記録なし</div>}</section>
    <section className="panel player-history"><div className="panel-heading"><h3>試合履歴</h3></div>{matchHistory.length ? <div className="player-history-list">{matchHistory.map(({ tournament, match, opponent, won, result }) => {
      const entryId = `${tournament.id}-${match.id}`
      const games = (match.gameLog ?? []).filter(game =>
        (game.server === match.a || game.server === match.b) &&
        (game.winner === match.a || game.winner === match.b)
      )
      const expanded = expandedMatchId === entryId
      return <div className="player-history-entry" key={entryId}>
        <button className="player-history-row" aria-expanded={expanded} onClick={() => setExpandedMatchId(expanded ? null : entryId)}>
          <div><strong>{tournament.name}</strong><span>{tournament.date} · {match.round}{match.surface ? ` · ${match.surface}` : ''}</span></div>
          <div className="player-history-opponent"><span>対戦相手</span><strong>{opponent?.name ?? (match.a && match.b ? '登録外の選手' : '未定')}</strong></div>
          <div className={`player-history-result ${match.winner ? won ? 'won' : 'lost' : ''}`}><strong>{result}</strong><span>{match.scoreA === null || match.scoreB === null ? '—' : `${match.scoreA} - ${match.scoreB}`}</span></div>
          <ChevronDown className={expanded ? 'expanded' : ''} size={16} />
        </button>
        {expanded && <div className="match-game-details">{games.length ? <ol>{games.map((game, index) => <li key={`${entryId}-game-${index}`}><span>第{index + 1}ゲーム</span><span>サーブ：{members.find(item => item.id === game.server)?.name ?? '不明'}</span><strong>{game.server === game.winner ? 'キープ' : 'ブレーク'}</strong><span>取得：{members.find(item => item.id === game.winner)?.name ?? '不明'}</span></li>)}</ol> : <p>キープ・ブレークの記録はありません。</p>}</div>}
      </div>
    })}</div> : <div className="empty-state">記録された試合はありません。</div>}</section>
  </>
}
function Members({ members, onAdd, onMember, onDelete }: { members: Member[]; onAdd: () => void; onMember: (m: Member) => void; onDelete: (m: Member) => void }) {
  return <><PageHeading title="人" action={<button className="btn-primary" onClick={onAdd}><Plus size={16} /> 部員を追加</button>} /><section className="panel member-list">{members.map(member => <div className="member-list-row" key={member.id}><button className="member-list-item" onClick={() => onMember(member)}><span>{member.name}</span><ChevronRight size={16} /></button><button className="icon-button light member-delete" aria-label={`${member.name}を削除`} title="部員を削除" onClick={() => onDelete(member)}><Trash2 size={15} /></button></div>)}{members.length === 0 && <div className="empty-state">部員がいません。</div>}</section></>
}
function TournamentPage({ tournaments, selected, setSelected, active, members, onNew, onGenerate, onConfirmManualDraw, onResult, onEdit, onNotice, onDelete, onSaveAwards, onSaveInfo }: { tournaments: Tournament[]; selected: string; setSelected: (s: string) => void; active: Tournament | undefined; members: Member[]; onNew: () => void; onGenerate: (method?: 'automatic' | 'manual') => void; onConfirmManualDraw: () => void; onResult: (m: Match) => void; onEdit: (m: Match, side: 'a' | 'b', id: string) => void; onNotice: (s: string) => void; onDelete: (t: Tournament) => void; onSaveAwards: (id: string, awards: Record<string, number>, expiryDays: number | null) => void; onSaveInfo: (id: string, info: { name: string; date: string; format: string; participantIds: string[] }) => void }) {
  const [tab, setTab] = useState('トーナメント')
  const [editingBracketMatchId, setEditingBracketMatchId] = useState<string | null>(null)
  const [awardsDraft, setAwardsDraft] = useState<Record<string, string>>({})
  const [expiryDraft, setExpiryDraft] = useState('')
  const [infoDraft, setInfoDraft] = useState<{ name: string; date: string; format: string; participantIds: string[] } | null>(null)
  useEffect(() => {
    setAwardsDraft(Object.fromEntries(Object.entries(active?.awardedPoints ?? {}).map(([memberId, points]) => [memberId, String(points)])))
    setExpiryDraft(active?.expiryDays === null || active?.expiryDays === undefined ? '' : String(active.expiryDays))
  }, [active?.id, active?.awardedPoints])
  useEffect(() => {
    if (tab === '試合結果' && active?.status !== '終了' && !Object.keys(active?.awardedPoints ?? {}).length) {
      setTab('トーナメント')
    }
  }, [active?.id, active?.status, active?.awardedPoints, tab])
  const saveAwards = () => {
    if (!active) return
    const entries = standings.map(({ member }) => [member.id, awardsDraft[member.id] ?? '0'] as const)
    const values = entries.map(([, value]) => Number(value))
    if (values.some(value => !Number.isInteger(value) || value < 0)) {
      onNotice('ポイントは0以上の整数を入力してください')
      return
    }
    const expiryDays = expiryDraft === '' ? null : Number(expiryDraft)
    if (expiryDays !== null && (!Number.isInteger(expiryDays) || expiryDays < 1)) {
      onNotice('有効期限は1日以上の整数、または空欄（無期限）で入力してください')
      return
    }
    onSaveAwards(active.id, Object.fromEntries(entries.map(([memberId, value]) => [memberId, Number(value)])), expiryDays)
  }
  const openInfoEditor = () => {
    if (!active) return
    setInfoDraft({
      name: active.name,
      date: active.date,
      format: active.format === 'リーグ' ? 'リーグ' : 'ノックアウト',
      participantIds: active.participantIds ?? members.slice(0, active.participants).map(member => member.id),
    })
  }
  const saveInfo = () => {
    if (!active || !infoDraft?.name.trim() || !infoDraft.date) {
      onNotice('試合名と開催日を入力してください')
      return
    }
    if (active.matches.length === 0 && infoDraft.participantIds.length < 2) {
      onNotice('試合には2人以上の参加者を選択してください')
      return
    }
    onSaveInfo(active.id, { ...infoDraft, name: infoDraft.name.trim() })
    setInfoDraft(null)
  }
  const rounds = active ? [...new Set(active.matches.map(m => m.round))] : []
  const getRoundLabel = (roundIndex: number) => {
    const remainingRounds = rounds.length - roundIndex - 1
    if (remainingRounds === 0) return '決勝'
    if (remainingRounds === 1) return '準決勝'
    if (remainingRounds === 2) return '準々決勝'
    return `${roundIndex + 1}回戦`
  }
  const tournamentMembers = active
    ? active.participantIds
      ? members.filter(member => active.participantIds?.includes(member.id))
      : members.slice(0, active.participants)
    : []
  const standings = active
    ? getTournamentStandings(active, active.matches).map(standing => ({
      ...standing,
      member: members.find(member => member.id === standing.memberId),
    })).filter((standing): standing is typeof standing & { member: Member } => Boolean(standing.member))
    : []
  const leagueMatchFor = (rowId: string, columnId: string) => active?.matches.find(match =>
    (match.a === rowId && match.b === columnId) || (match.a === columnId && match.b === rowId)
  )
  const getBracketDisplayMatch = (roundIndex: number, matchIndex: number): Match | undefined => {
    if (!active || !rounds[roundIndex]) return undefined
    const match = active.matches.filter(item => item.round === rounds[roundIndex])[matchIndex]
    if (!match) return undefined
    if (roundIndex === 0) {
      if (active.manualDraw) return { ...match, winner: null }
      const byeWinner = match.a && !match.b ? match.a : !match.a && match.b ? match.b : null
      const recordedWinner = match.scoreA !== null && match.scoreB !== null && (match.winner === match.a || match.winner === match.b)
      return { ...match, winner: byeWinner ?? (recordedWinner ? match.winner : null) }
    }

    const previousRoundMatches = active.matches.filter(item => item.round === rounds[roundIndex - 1])
    const feederA = getBracketDisplayMatch(roundIndex - 1, matchIndex * 2)
    const feederB = matchIndex * 2 + 1 < previousRoundMatches.length
      ? getBracketDisplayMatch(roundIndex - 1, matchIndex * 2 + 1)
      : undefined
    const advancingA = feederA?.winner ?? ''
    const advancingB = feederB?.winner ?? ''
    const sameDraw = match.a === advancingA && match.b === advancingB
    const recordedWinner = sameDraw && match.scoreA !== null && match.scoreB !== null &&
      (match.winner === advancingA || match.winner === advancingB)
    const byeWinner = advancingA && !advancingB ? advancingA : !advancingA && advancingB ? advancingB : null
    return {
      ...match,
      a: advancingA,
      b: advancingB,
      winner: byeWinner ?? (recordedWinner ? match.winner : null),
      scoreA: recordedWinner ? match.scoreA : null,
      scoreB: recordedWinner ? match.scoreB : null,
      surface: recordedWinner ? match.surface : undefined,
      gameLog: recordedWinner ? match.gameLog : undefined,
    }
  }
  return <>
    <PageHeading title="試合" action={<button className="btn-primary" onClick={onNew}><Plus size={16} /> 試合を作成</button>} />
    <div className="tournament-layout">
      <aside className="panel tournament-sidebar">
        <div className="panel-heading"><h3>試合一覧</h3><button className="icon-button light" onClick={onNew}><Plus size={17} /></button></div>
        <div className="tournament-side-list">{tournaments.map(t => <button key={t.id} className={`tournament-side-item ${selected === t.id ? 'selected' : ''}`} onClick={() => setSelected(t.id)}><strong>{t.name}</strong><StatusPill status={t.status} /></button>)}</div>
      </aside>
      <section className="panel tournament-detail">
        {active ? <>
          <div className="tournament-detail-head"><h2>{active.name}</h2><div className="tournament-detail-actions"><StatusPill status={active.status} /><button className="icon-button light tournament-delete" aria-label="試合を削除" title="試合を削除" onClick={() => onDelete(active)}><Trash2 size={16} /></button></div></div>
          <div className="tournament-tabs">{['トーナメント', ...(active.status === '終了' || Object.keys(active.awardedPoints ?? {}).length ? ['試合結果'] : []), '試合情報'].map(x => <button key={x} className={tab === x ? 'selected' : ''} onClick={() => setTab(x)}>{x}</button>)}</div>
          {tab === 'トーナメント' && <>
            <div className="bracket-toolbar">
              <strong>{active.format === 'リーグ' ? 'リーグ戦' : '対戦表'}</strong>
              {active.manualDraw && <div className="bracket-toolbar-actions"><button className="btn-secondary small" onClick={() => onGenerate('automatic')}><Sparkles size={14} /> 自動ランダム設定</button><button className="btn-primary small" onClick={onConfirmManualDraw}>組合せを確定</button></div>}
              {!active.manualDraw && (active.matches.length > 0 || active.format === 'リーグ') && (
                <div className="bracket-toolbar-actions">
                  <button className="btn-secondary small" onClick={() => onGenerate('automatic')}><Sparkles size={14} /> {active.matches.length ? '自動で再生成' : '自動生成'}</button>
                  {active.format !== 'リーグ' && <button className="btn-secondary small" onClick={() => onGenerate('manual')}>手動で作成</button>}
                </div>
              )}
            </div>
            {active.matches.length === 0
                ? <div className="bracket-empty"><div className="bracket-empty-icon"><Trophy size={25} /></div><h3>{active.format === 'リーグ' ? 'リーグ戦はまだありません' : 'トーナメントはまだありません'}</h3>{active.format === 'リーグ' ? <button className="btn-primary" onClick={() => onGenerate('automatic')}><Sparkles size={15} /> リーグ戦を生成</button> : <div className="bracket-empty-actions"><button className="btn-primary" onClick={() => onGenerate('automatic')}><Sparkles size={15} /> 自動生成</button><button className="btn-secondary" onClick={() => onGenerate('manual')}>手動で作成</button></div>}</div>
              : <>
                {active.format === 'リーグ' ? <section className="league-matrix-section">
                  <div className="league-matrix-heading"><h3>対戦結果</h3></div>
                  <div className="league-matrix-wrap"><table className="league-matrix"><thead><tr><th className="league-matrix-corner">選手</th>{tournamentMembers.map(member => <th key={member.id}>{member.name}</th>)}</tr></thead><tbody>{tournamentMembers.map(rowMember => <tr key={rowMember.id}><th>{rowMember.name}</th>{tournamentMembers.map(columnMember => {
                    if (rowMember.id === columnMember.id) return <td className="league-matrix-diagonal" key={columnMember.id}>—</td>
                    const match = leagueMatchFor(rowMember.id, columnMember.id)
                    if (!match) return <td className="league-matrix-empty" key={columnMember.id}>—</td>
                    const rowScore = match.a === rowMember.id ? match.scoreA : match.scoreB
                    const columnScore = match.a === rowMember.id ? match.scoreB : match.scoreA
                    const rowWon = match.winner === rowMember.id
                    return <td key={columnMember.id}><button className={`league-matrix-result ${match.winner ? rowWon ? 'won' : 'lost' : 'pending'}`} onClick={() => onResult(match)} aria-label={`${rowMember.name} 対 ${columnMember.name} の結果を${match.winner ? '修正' : '入力'}`}><strong>{rowScore === null || columnScore === null ? '入力' : `${rowScore} - ${columnScore}`}</strong><span>{match.winner ? rowWon ? '勝ち' : '負け' : '未実施'}</span></button></td>
                  })}</tr>)}</tbody></table></div>
                  <div className="league-rankings"><h3>順位</h3><div className="league-ranking-list">{standings.map(standing => <div className="league-ranking-item" key={standing.member.id}><strong>{standing.place}位</strong><span>{standing.member.name}</span><span>{standing.wins}勝 {standing.losses}敗</span></div>)}</div></div>
                </section> : <div className="bracket-scroll"><div className="bracket-board">{rounds.map((round, roundIndex) => {
                  const roundMatches = active.matches.filter(match => match.round === round)
                  const bracketSlots = active.matches.filter(match => match.round === rounds[0]).length
                  const matchSpan = 2 ** roundIndex
                  return <section className="bracket-round-column" key={round}><h3>{getRoundLabel(roundIndex)}</h3><div className="bracket-round-matches" style={{ gridTemplateRows: `repeat(${bracketSlots}, minmax(92px, 1fr))` }}>{roundMatches.map((originalMatch, matchIndex) => {
                    const match = getBracketDisplayMatch(roundIndex, matchIndex) ?? originalMatch
                    const memberA = members.find(member => member.id === match.a)
                    const memberB = members.find(member => member.id === match.b)
                    const isMatchResultRecorded = originalMatch.scoreA !== null && originalMatch.scoreB !== null
                    const isEditingFirstRound = active.manualDraw || editingBracketMatchId === match.id
                    const slotLabel = (side: 'a' | 'b') => {
                      if (roundIndex === 0) return active.manualDraw ? '未設定' : 'BYE'
                      return '—'
                    }
                    const handlePlayerClick = () => {
                      if (active.manualDraw || (roundIndex === 0 && !isMatchResultRecorded && !isEditingFirstRound)) {
                        setEditingBracketMatchId(isEditingFirstRound ? null : match.id)
                        return
                      }
                      if (!active.manualDraw && match.a && match.b) onResult(match)
                    }
                    return <article className="bracket-match" key={match.id} style={{ gridRow: `${matchIndex * matchSpan + 1} / span ${matchSpan}` }}>
                      <button className={`bracket-player ${match.winner === match.a && match.a ? 'winner' : ''}`} onClick={handlePlayerClick} disabled={!match.a && !match.b}><span>{memberA?.name ?? (match.a ? '登録外' : slotLabel('a'))}</span><strong>{match.scoreA ?? (match.winner === match.a && match.a && !match.b ? 'BYE' : '—')}</strong></button>
                      <button className={`bracket-player ${match.winner === match.b && match.b ? 'winner' : ''}`} onClick={handlePlayerClick} disabled={!match.a && !match.b}><span>{memberB?.name ?? (match.b ? '登録外' : slotLabel('b'))}</span><strong>{match.scoreB ?? (match.winner === match.b && match.b && !match.a ? 'BYE' : '—')}</strong></button>
                      {roundIndex === 0 && isEditingFirstRound && <div className="bracket-slot-edit"><label><span>選手A</span><select aria-label="選手Aを変更" value={match.a} disabled={isMatchResultRecorded} onChange={event => onEdit(originalMatch, 'a', event.target.value)}><option value="">BYE / 未設定</option>{tournamentMembers.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label><span>選手B</span><select aria-label="選手Bを変更" value={match.b} disabled={isMatchResultRecorded} onChange={event => onEdit(originalMatch, 'b', event.target.value)}><option value="">BYE / 未設定</option>{tournamentMembers.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label></div>}
                    </article>
                  })}</div></section>
                })}</div></div>}
              </>}
          </>}
          {tab === '試合結果' && (active.status === '終了' || Object.keys(active.awardedPoints ?? {}).length > 0) && <section className="tournament-results">
            <table><thead><tr><th>順位</th><th>選手</th><th>成績</th><th>付与ポイント</th></tr></thead><tbody>{standings.map(standing => <tr key={standing.member.id}><td>{standing.place}位</td><td>{standing.member.name}</td><td>{active.format === 'リーグ' ? `${standing.wins}勝 ${standing.losses}敗` : '確定'}</td><td><label className="award-points-field"><input className="field-input" aria-label={`${standing.member.name}に付与するポイント`} type="number" min="0" step="1" value={awardsDraft[standing.member.id] ?? ''} onChange={event => setAwardsDraft(current => ({ ...current, [standing.member.id]: event.target.value }))} /><span>pt</span></label></td></tr>)}</tbody></table>
            {standings.length === 0 ? <p>試合結果はありません。</p> : <div className="point-save-actions"><label className="expiry-field">ポイントの有効期限（日数）<input className="field-input" aria-label="ポイントの有効期限（日数）" type="number" min="1" step="1" placeholder="無期限" value={expiryDraft} onChange={event => setExpiryDraft(event.target.value)} /><span>空欄は無期限</span></label><button className="btn-primary" onClick={saveAwards}><Save size={15} /> 結果とポイントを保存</button></div>}
          </section>}
          {tab === '試合情報' && <div className="tournament-info-panel"><div><span>試合名</span><strong>{active.name}</strong></div><div><span>開催日</span><strong>{active.date}</strong></div><div><span>試合形式</span><strong>{active.format === 'リーグ' ? 'リーグ（総当たり）' : 'トーナメント'}</strong></div><div><span>参加人数</span><strong>{active.participants}人</strong></div><div><span>状態</span><strong>{active.status}</strong></div><button className="btn-secondary" onClick={openInfoEditor}>試合情報を編集</button></div>}
          {infoDraft && active && <Modal title="試合情報を編集" onClose={() => setInfoDraft(null)}>
            <label className="field-label" htmlFor="edit-tournament-name">試合名</label><input id="edit-tournament-name" className="field-input" value={infoDraft.name} onChange={event => setInfoDraft(current => current ? { ...current, name: event.target.value } : current)} autoFocus />
            <label className="field-label" htmlFor="edit-tournament-date">開催日</label><input id="edit-tournament-date" className="field-input" type="date" value={infoDraft.date} onChange={event => setInfoDraft(current => current ? { ...current, date: event.target.value } : current)} />
            <label className="field-label" htmlFor="edit-tournament-format">試合形式</label><select id="edit-tournament-format" className="field-input" value={infoDraft.format} disabled={active.matches.length > 0} onChange={event => setInfoDraft(current => current ? { ...current, format: event.target.value } : current)}><option value="ノックアウト">トーナメント</option><option value="リーグ">リーグ（総当たり）</option></select>
            {active.matches.length === 0 && <div className="participant-picker"><div className="participant-picker-heading"><span className="field-label">参加者（{infoDraft.participantIds.length}人選択）</span><button type="button" className="participant-select-all" onClick={() => setInfoDraft(current => current ? { ...current, participantIds: current.participantIds.length === members.length ? [] : members.map(member => member.id) } : current)}>{infoDraft.participantIds.length === members.length ? '全解除' : '全員選択'}</button></div><div className="participant-picker-list">{members.map(member => <label className="participant-option" key={member.id}><input type="checkbox" checked={infoDraft.participantIds.includes(member.id)} onChange={event => setInfoDraft(current => current ? { ...current, participantIds: event.target.checked ? [...current.participantIds, member.id] : current.participantIds.filter(id => id !== member.id) } : current)} /><span>{member.name}</span></label>)}</div></div>}
            <div className="modal-actions"><button className="btn-secondary" onClick={() => setInfoDraft(null)}>キャンセル</button><button className="btn-primary" onClick={saveInfo}>変更を保存 <Check size={15} /></button></div>
          </Modal>}
        </> : <div className="empty-state">試合を作成してください。</div>}
      </section>
    </div>
  </>
}
function StatusPill({ status }: { status: string }) { return <span className={`status-pill ${status === '開催中' ? 'in-progress' : status === '終了' ? 'finished' : 'preparing'}`}><i />{status}</span> }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler) }, [onClose])
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><div className="modal"><div className="modal-head"><h2>{title}</h2><button className="icon-button light" onClick={onClose}><X size={18} /></button></div><div className="modal-body">{children}</div></div></div>
}
export default App
