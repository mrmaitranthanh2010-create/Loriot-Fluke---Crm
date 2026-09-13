"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type SalesAgentMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

type PanelProps = {
  open: boolean;
  view: string;
  onClose: () => void;
};

const QUICK_QUESTIONS = [
  "Hôm nay tôi nên ưu tiên xử lý cơ hội nào?",
  "Phân tích các cơ hội Hot và đề xuất Next Step.",
  "Soạn bản nháp follow-up lịch sự cho một khách đang chờ phản hồi.",
  "Model tôi đang hỏi có cần Logcard không?",
];

const initialMessage: SalesAgentMessage = {
  id: "welcome",
  role: "assistant",
  text: "Em là Trợ lý Sales AI của anh. Em có thể đọc CRM để gợi ý ưu tiên, phân tích cơ hội, soạn bản nháp email và tra Model/Logcard. Em chỉ tư vấn — không tự gửi email hoặc thay đổi dữ liệu.",
  createdAt: "",
};

const socketUrl = () => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/agents/loriot-sales-agent/mai-tran-thanh`;
};

export function SalesAiPanel({ open, view, onClose }: PanelProps) {
  const [messages, setMessages] = useState<SalesAgentMessage[]>([initialMessage]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"connecting" | "online" | "offline">("offline");
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setStatus("connecting");
    setError("");
    const socket = new WebSocket(socketUrl());
    socketRef.current = socket;
    socket.onopen = () => {
      setStatus("online");
      setError("");
    };
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as {
          type?: string;
          messages?: SalesAgentMessage[];
          message?: SalesAgentMessage;
          error?: string;
        };
        if (payload.type === "sales-agent-history" && Array.isArray(payload.messages)) {
          setMessages(payload.messages.length ? payload.messages : [initialMessage]);
          setWaiting(false);
        }
        if (payload.type === "sales-agent-user" && payload.message) {
          setMessages((current) => [...current.filter((item) => item.id !== payload.message?.id), payload.message!]);
        }
        if (payload.type === "sales-agent-reply" && payload.message) {
          setMessages((current) => [...current.filter((item) => item.id !== payload.message?.id), payload.message!]);
          setWaiting(false);
        }
        if (payload.type === "sales-agent-error") {
          setError(payload.error || "Trợ lý AI chưa thể xử lý yêu cầu.");
          setWaiting(false);
        }
      } catch {
        setError("Không thể đọc phản hồi từ Trợ lý AI.");
        setWaiting(false);
      }
    };
    socket.onerror = () => {
      setStatus("offline");
      setError("Không thể kết nối Trợ lý AI. Anh thử đóng rồi mở lại cửa sổ này.");
      setWaiting(false);
    };
    socket.onclose = () => {
      setStatus("offline");
      setWaiting(false);
    };
    return () => {
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open, waiting]);

  const ask = (question: string) => {
    const text = question.trim();
    if (!text || waiting) return;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("Trợ lý AI đang chưa kết nối. Anh thử lại sau vài giây.");
      return;
    }
    setError("");
    setWaiting(true);
    setInput("");
    socket.send(JSON.stringify({ type: "ask", message: text, view }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    ask(input);
  };

  const resetConversation = () => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "reset" }));
    setMessages([initialMessage]);
    setError("");
    setWaiting(false);
  };

  if (!open) return null;

  return <div className="sales-ai-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="sales-ai-panel" role="dialog" aria-modal="true" aria-label="Trợ lý Sales AI">
      <header className="sales-ai-header">
        <div className="sales-ai-title"><span className="sales-ai-orb">✦</span><div><small>TRỢ LÝ NỘI BỘ · CHỈ TƯ VẤN</small><h2>Trợ lý Sales AI</h2><p><i className={`sales-ai-status ${status}`} />{status === "online" ? "Đang kết nối CRM" : status === "connecting" ? "Đang kết nối…" : "Chưa kết nối"}</p></div></div>
        <div className="sales-ai-header-actions"><button type="button" className="sales-ai-reset" onClick={resetConversation}>Làm mới</button><button type="button" className="modal-close" aria-label="Đóng Trợ lý AI" onClick={onClose}>×</button></div>
      </header>
      <div className="sales-ai-body" ref={messagesRef}>
        {messages.map((message) => <article key={message.id} className={`sales-ai-message ${message.role}`}><span>{message.role === "assistant" ? "AI" : "MT"}</span><p>{message.text}</p></article>)}
        {waiting && <article className="sales-ai-message assistant thinking"><span>AI</span><p><i /> <i /> <i /></p></article>}
      </div>
      {messages.length <= 1 && <div className="sales-ai-suggestions"><small>GỢI Ý ĐỂ BẮT ĐẦU</small><div>{QUICK_QUESTIONS.map((question) => <button key={question} type="button" disabled={status !== "online" || waiting} onClick={() => ask(question)}>{question}</button>)}</div></div>}
      {error && <p className="sales-ai-error">{error}</p>}
      <form className="sales-ai-composer" onSubmit={submit}>
        <textarea value={input} maxLength={1800} rows={2} onChange={(event) => setInput(event.target.value)} placeholder="Ví dụ: Gợi ý Next Step cho cơ hội của khách A…" disabled={status !== "online" || waiting} />
        <button type="submit" className="sales-ai-send" disabled={!input.trim() || status !== "online" || waiting} aria-label="Gửi câu hỏi">↑</button>
      </form>
      <footer>AI chỉ tham chiếu dữ liệu CRM; hãy kiểm tra giá, tồn kho, kỹ thuật và nội dung email trước khi gửi khách.</footer>
    </section>
  </div>;
}
