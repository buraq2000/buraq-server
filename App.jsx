import process from "process";
window.process = process;

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import Peer from "simple-peer/simplepeer.min.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";

import { auth } from "./firebase";

const socket = io("http://" + window.location.hostname + ":3001", {
  transports: ["websocket"],
});

function App() {
  const [user, setUser] = useState(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [authError, setAuthError] = useState("");

  const [profileName, setProfileName] = useState("");
  const [buraqId, setBuraqId] = useState("");
  const [joined, setJoined] = useState(false);

  const [friendId, setFriendId] = useState("");
  const [friendName, setFriendName] = useState("");
  const [status, setStatus] = useState("Connecting to server...");

  const [contacts, setContacts] = useState([]);
  const [contactStatuses, setContactStatuses] = useState({});

  const [activeChat, setActiveChat] = useState(null);
  const [messageText, setMessageText] = useState("");
  const [chatMessages, setChatMessages] = useState({});
  const [unreadCounts, setUnreadCounts] = useState({});
  const [chatsLoaded, setChatsLoaded] = useState(false);

  const [activeTab, setActiveTab] = useState("home");

  const [incomingCall, setIncomingCall] = useState(null);
  const [callTo, setCallTo] = useState(null);
  const [callName, setCallName] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);

  const myPeer = useRef(null);
  const myStream = useRef(null);
  const remoteAudio = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);

      if (!currentUser) {
        setJoined(false);
        setBuraqId("");
        setProfileName("");
        setContacts([]);
        setChatMessages({});
        setUnreadCounts({});
        setActiveChat(null);
        setChatsLoaded(false);
        return;
      }

      const savedProfile = localStorage.getItem(
        "buraq_profile_" + currentUser.uid
      );

      if (savedProfile) {
        try {
          const data = JSON.parse(savedProfile);
          setProfileName(data.profileName || "");
          setBuraqId(data.buraqId || "");
        } catch {
          console.log("Profile load error");
        }
      }

      const savedContacts = localStorage.getItem(
        "buraq_contacts_" + currentUser.uid
      );

      if (savedContacts) {
        try {
          setContacts(JSON.parse(savedContacts));
        } catch {
          setContacts([]);
        }
      } else {
        setContacts([]);
      }

      const savedChats = localStorage.getItem(
        "buraq_chats_" + currentUser.uid
      );

      if (savedChats) {
        try {
          setChatMessages(JSON.parse(savedChats));
        } catch {
          setChatMessages({});
        }
      } else {
        setChatMessages({});
      }

      setChatsLoaded(true);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !chatsLoaded) return;

    localStorage.setItem(
      "buraq_chats_" + user.uid,
      JSON.stringify(chatMessages)
    );
  }, [chatMessages, user, chatsLoaded]);

  useEffect(() => {
    if (!user || !chatsLoaded) return;

    localStorage.setItem(
      "buraq_contacts_" + user.uid,
      JSON.stringify(contacts)
    );
  }, [contacts, user, chatsLoaded]);

  useEffect(() => {
    if (!callTo) {
      setCallSeconds(0);
      return;
    }

    const timer = setInterval(() => {
      setCallSeconds((seconds) => seconds + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [callTo]);

  const getCallTime = () => {
    const minutes = Math.floor(callSeconds / 60);
    const seconds = callSeconds % 60;

    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");

    return mm + ":" + ss;
  };

  useEffect(() => {
    const onConnect = () => {
      console.log("Buraq socket connected:", socket.id);

      setStatus("Server connected");

      if (buraqId && profileName) {
        socket.emit("join", {
          userId: buraqId,
          userName: profileName,
        });
      }
    };

    const onDisconnect = () => {
      console.log("Buraq socket disconnected");
      setStatus("Server disconnected");
    };

    const onConnectError = (error) => {
      console.error("Socket connection error:", error);
      setStatus("Server connection error");
    };

    const onIncomingCall = ({ signal, from, fromName }) => {
      console.log("Incoming call:", fromName, from);

      setIncomingCall({
        signal,
        from,
        fromName: fromName || from,
      });

      setStatus("Incoming call from " + (fromName || from));
    };

    const onCallAccepted = (signal) => {
      console.log("Call accepted");

      if (myPeer.current) {
        myPeer.current.signal(signal);
      }
    };

    const onCallEnded = () => {
      endCall(false);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("incoming-call", onIncomingCall);
    socket.on("call-accepted", onCallAccepted);
    socket.on("call-ended", onCallEnded);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("incoming-call", onIncomingCall);
      socket.off("call-accepted", onCallAccepted);
      socket.off("call-ended", onCallEnded);
    };
  }, [buraqId, profileName]);

  // =========================
  // RECEIVE MESSAGE (FIXED)
  // Message ayacha aale automatic aayi contact list-il add cheyyum
  // =========================
  useEffect(() => {
    const onReceiveMessage = ({ from, fromName, message, time }) => {
      const newMessage = { from, fromName, message, time };

      setContacts((current) => {
        if (current.some((c) => c.id === from)) return current;
        return [...current, { id: from, name: fromName || from }];
      });

      setChatMessages((current) => ({
        ...current,
        [from]: [...(current[from] || []), newMessage],
      }));

      setUnreadCounts((current) => {
        if (activeChat && activeChat.id === from) {
          return { ...current, [from]: 0 };
        }

        return { ...current, [from]: (current[from] || 0) + 1 };
      });
    };

    socket.on("receive-message", onReceiveMessage);

    return () => {
      socket.off("receive-message", onReceiveMessage);
    };
  }, [activeChat]);

  useEffect(() => {
    const onUserStatus = ({ userId, online }) => {
      setContactStatuses((current) => ({
        ...current,
        [userId]: online,
      }));
    };

    const onUserOnline = ({ userId, userName }) => {
      setContactStatuses((current) => ({
        ...current,
        [userId]: true,
      }));

      setContacts((current) =>
        current.map((contact) =>
          contact.id === userId
            ? { ...contact, name: contact.name || userName }
            : contact
        )
      );
    };

    const onUserOffline = ({ userId }) => {
      setContactStatuses((current) => ({
        ...current,
        [userId]: false,
      }));
    };

    socket.on("user-status", onUserStatus);
    socket.on("user-online", onUserOnline);
    socket.on("user-offline", onUserOffline);

    return () => {
      socket.off("user-status", onUserStatus);
      socket.off("user-online", onUserOnline);
      socket.off("user-offline", onUserOffline);
    };
  }, []);

  useEffect(() => {
    if (!contacts.length) return;

    contacts.forEach((contact) => {
      checkFriendStatusForId(contact.id);
    });
  }, [contacts.length, buraqId]);

  const checkFriendStatusForId = (id) => {
    if (!id) return;

    socket.emit("check-user", {
      userId: id,
    });
  };

  const handleAuth = async () => {
    setAuthError("");

    if (!email.trim() || !password) {
      setAuthError("Email and password enter cheyyuka");
      return;
    }

    try {
      if (isSignup) {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }

      setEmail("");
      setPassword("");
    } catch (error) {
      console.error(error);
      setAuthError(error.message);
    }
  };

  const joinBuraq = () => {
    const cleanId = buraqId.trim();
    const cleanName = profileName.trim();

    if (!cleanName) {
      alert("Your name enter cheyyuka");
      return;
    }

    if (!cleanId) {
      alert("Buraq ID enter cheyyuka");
      return;
    }

    if (!socket.connected) {
      alert("Buraq server connect aayittilla");
      return;
    }

    socket.emit(
      "join",
      {
        userId: cleanId,
        userName: cleanName,
      },
      (response) => {
        if (response && response.success === false) {
          alert(response.message || "Buraq ID already in use");
          return;
        }

        setProfileName(cleanName);
        setBuraqId(cleanId);

        setJoined(true);
        setStatus("Ready");

        if (user) {
          localStorage.setItem(
            "buraq_profile_" + user.uid,
            JSON.stringify({
              profileName: cleanName,
              buraqId: cleanId,
            })
          );
        }
      }
    );
  };

  const callUser = async (customId, customName) => {
    const target = (customId || friendId).trim();
    const targetName = customName || target;

    if (!target) {
      alert("Friend Buraq ID enter cheyyuka");
      return;
    }

    if (target === buraqId) {
      alert("Own Buraq ID-il call cheyyan pattilla");
      return;
    }

    if (!socket.connected) {
      alert("Server connect aayittilla");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      myStream.current = stream;

      const peer = new Peer({
        initiator: true,
        trickle: false,
        stream: stream,
      });

      peer.on("signal", (signal) => {
        socket.emit("call-user", {
          userToCall: target,
          signalData: signal,
          from: buraqId,
          fromName: profileName,
        });
      });

      peer.on("stream", (remoteStream) => {
        console.log("REMOTE AUDIO STREAM RECEIVED");

        if (remoteAudio.current) {
          remoteAudio.current.srcObject = remoteStream;
          remoteAudio.current.play().catch(() => {});
        }
      });

      peer.on("connect", () => {
        console.log("PEER CONNECTED");
        setStatus("Connected");
      });

      peer.on("error", (error) => {
        console.error("Peer error:", error);
        setStatus("Call error");
      });

      peer.on("close", () => {
        endCall(false);
      });

      myPeer.current = peer;

      setCallTo(target);
      setCallName(targetName);
      setCallSeconds(0);

      setStatus("Calling " + targetName + "...");
    } catch (error) {
      console.error(error);
      alert("Microphone permission allow cheyyuka");
    }
  };

  const acceptCall = async () => {
    if (!incomingCall) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      myStream.current = stream;

      const peer = new Peer({
        initiator: false,
        trickle: false,
        stream: stream,
      });

      peer.on("signal", (signal) => {
        socket.emit("answer-call", {
          to: incomingCall.from,
          signal: signal,
        });
      });

      peer.on("stream", (remoteStream) => {
        if (remoteAudio.current) {
          remoteAudio.current.srcObject = remoteStream;
          remoteAudio.current.play().catch(() => {});
        }
      });

      peer.on("connect", () => {
        setStatus("Connected");
      });

      peer.on("error", (error) => {
        console.error("Peer error:", error);
        setStatus("Call error");
      });

      peer.on("close", () => {
        endCall(false);
      });

      peer.signal(incomingCall.signal);

      myPeer.current = peer;

      setCallTo(incomingCall.from);
      setCallName(incomingCall.fromName || incomingCall.from);

      setIncomingCall(null);
      setCallSeconds(0);

      setStatus("Connecting...");
    } catch (error) {
      console.error(error);
      alert("Microphone permission allow cheyyuka");
    }
  };

  const rejectCall = () => {
    if (incomingCall) {
      socket.emit("end-call", {
        to: incomingCall.from,
      });
    }

    setIncomingCall(null);
    setStatus("Ready");
  };

  const endCall = (sendSignal = true) => {
    if (sendSignal && callTo) {
      socket.emit("end-call", {
        to: callTo,
      });
    }

    if (myPeer.current) {
      try {
        myPeer.current.destroy();
      } catch {}

      myPeer.current = null;
    }

    if (myStream.current) {
      myStream.current.getTracks().forEach((track) => track.stop());
      myStream.current = null;
    }

    if (remoteAudio.current) {
      remoteAudio.current.srcObject = null;
    }

    setCallTo(null);
    setCallName("");
    setIncomingCall(null);
    setIsMuted(false);
    setCallSeconds(0);
    setStatus("Ready");
  };

  const toggleMute = () => {
    if (!myStream.current) return;

    const track = myStream.current.getAudioTracks()[0];

    if (track) {
      track.enabled = !track.enabled;
      setIsMuted(!track.enabled);
    }
  };

  const addContact = () => {
    const id = friendId.trim();
    const name = friendName.trim() || id;

    if (!id) {
      alert("Buraq ID enter cheyyuka");
      return;
    }

    if (id === buraqId) {
      alert("Own Buraq ID add cheyyan pattilla");
      return;
    }

    const exists = contacts.some((contact) => contact.id === id);

    if (exists) {
      alert("Contact already added");
      return;
    }

    setContacts((current) => [...current, { id, name }]);

    setFriendId("");
    setFriendName("");

    checkFriendStatusForId(id);
  };

  const removeContact = (id) => {
    const ok = window.confirm("Ee contact remove cheyyano?");

    if (!ok) return;

    setContacts((current) => current.filter((contact) => contact.id !== id));

    setContactStatuses((current) => {
      const copy = { ...current };
      delete copy[id];
      return copy;
    });
  };

  const openChat = (contact) => {
    setActiveChat(contact);

    setUnreadCounts((current) => ({
      ...current,
      [contact.id]: 0,
    }));
  };

  const closeChat = () => {
    setActiveChat(null);
    setMessageText("");
  };

  const sendMessage = () => {
    const text = messageText.trim();

    if (!text) return;

    if (!socket.connected) {
      alert("Server connect aayittilla");
      return;
    }

    if (!activeChat) return;

    const newMessage = {
      from: buraqId,
      fromName: profileName,
      message: text,
      time: new Date().toISOString(),
    };

    setChatMessages((current) => ({
      ...current,
      [activeChat.id]: [...(current[activeChat.id] || []), newMessage],
    }));

    socket.emit("send-message", {
      to: activeChat.id,
      from: buraqId,
      fromName: profileName,
      message: text,
    });

    setMessageText("");
  };

  const clearChat = () => {
    if (!activeChat) return;

    const ok = window.confirm("Ee chat history clear cheyyano?");

    if (!ok) return;

    setChatMessages((current) => ({
      ...current,
      [activeChat.id]: [],
    }));
  };

  const formatTime = (time) => {
    if (!time) return "";

    try {
      return new Date(time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  const logout = async () => {
    endCall(false);

    setJoined(false);
    setBuraqId("");
    setProfileName("");
    setFriendId("");
    setFriendName("");
    setActiveChat(null);
    setMessageText("");
    setUnreadCounts({});

    await signOut(auth);
  };

  const bottomNavigation = (
    <div
      style={{
        position: "fixed",
        bottom: "14px",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(92%, 460px)",
        padding: "8px",
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: "20px",
        boxShadow: "0 12px 35px rgba(15,23,42,.15)",
        display: "flex",
        gap: "6px",
        zIndex: 9999,
        boxSizing: "border-box",
      }}
    >
      <button onClick={() => setActiveTab("home")} style={{ flex: 1, border: "none", borderRadius: "14px", padding: "9px 5px", background: activeTab === "home" ? "#eef2ff" : "transparent", color: activeTab === "home" ? "#4f46e5" : "#64748b", fontWeight: "800", cursor: "pointer" }}>
        🏠<div style={{ fontSize: "10px", marginTop: "3px" }}>Home</div>
      </button>
      <button onClick={() => setActiveTab("contacts")} style={{ flex: 1, border: "none", borderRadius: "14px", padding: "9px 5px", background: activeTab === "contacts" ? "#eef2ff" : "transparent", color: activeTab === "contacts" ? "#4f46e5" : "#64748b", fontWeight: "800", cursor: "pointer" }}>
        👥<div style={{ fontSize: "10px", marginTop: "3px" }}>Contacts</div>
      </button>
      <button onClick={() => setActiveTab("chat")} style={{ flex: 1, border: "none", borderRadius: "14px", padding: "9px 5px", background: activeTab === "chat" ? "#eef2ff" : "transparent", color: activeTab === "chat" ? "#4f46e5" : "#64748b", fontWeight: "800", cursor: "pointer" }}>
        💬<div style={{ fontSize: "10px", marginTop: "3px" }}>Chat</div>
      </button>
      <button onClick={() => setActiveTab("profile")} style={{ flex: 1, border: "none", borderRadius: "14px", padding: "9px 5px", background: activeTab === "profile" ? "#eef2ff" : "transparent", color: activeTab === "profile" ? "#4f46e5" : "#64748b", fontWeight: "800", cursor: "pointer" }}>
        👤<div style={{ fontSize: "10px", marginTop: "3px" }}>Profile</div>
      </button>
    </div>
  );

  if (!user) {
    return (
      <div style={styles.page}>
        <div style={styles.loginCard}>
          <div style={styles.logoCircle}>B</div>

          <h1 style={styles.logo}>BURAQ</h1>

          <p style={styles.subtitle}>
            {isSignup
              ? "Create your Buraq account"
              : "Private voice calling & chat"}
          </p>

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
          />

          {authError && <p style={styles.error}>{authError}</p>}

          <button onClick={handleAuth} style={styles.primaryButton}>
            {isSignup ? "Create Account" : "Login"}
          </button>

          <button
            onClick={() => {
              setIsSignup(!isSignup);
              setAuthError("");
            }}
            style={styles.linkButton}
          >
            {isSignup
              ? "Already have an account? Login"
              : "Create new account"}
          </button>
        </div>
      </div>
    );
  }

  if (!joined) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.header}>
            <div>
              <div style={styles.miniLogo}>BURAQ</div>
              <p style={styles.subtitle}>Create your profile</p>
            </div>

            <button onClick={logout} style={styles.logoutButton}>
              Logout
            </button>
          </div>

          <div style={{ padding: "0 26px 26px" }}>
            <input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Enter your name"
              style={styles.input}
            />

            <input
              value={buraqId}
              onChange={(e) => setBuraqId(e.target.value)}
              placeholder="Enter your Buraq ID"
              style={styles.input}
            />

            <button onClick={joinBuraq} style={styles.primaryButton}>
              Join Buraq
            </button>

            <p style={styles.serverStatus}>{status}</p>
          </div>
        </div>
      </div>
    );
  }

  if (callTo) {
    return (
      <div style={styles.callPage}>
        <audio ref={remoteAudio} autoPlay playsInline />

        <div style={styles.callScreen}>
          <div style={styles.callTop}>
            <span style={styles.callLabel}>BURAQ CALL</span>
            <span style={styles.liveBadge}>● LIVE</span>
          </div>

          <div style={styles.avatar}>
            {callName ? callName.charAt(0).toUpperCase() : "B"}
          </div>

          <h1 style={styles.callerName}>{callName || callTo}</h1>

          <p style={styles.callerId}>Buraq ID: {callTo}</p>

          <div style={styles.connectionStatus}>
            <span style={styles.statusDot}></span>
            {status}
          </div>

          <div style={styles.timer}>{getCallTime()}</div>

          <div style={styles.wave}>
            <span style={styles.wave1}></span>
            <span style={styles.wave2}></span>
            <span style={styles.wave3}></span>
            <span style={styles.wave4}></span>
            <span style={styles.wave5}></span>
          </div>

          <div style={styles.bottomControls}>
            <button
              onClick={toggleMute}
              style={{
                ...styles.controlButton,
                ...(isMuted ? styles.mutedButton : {}),
              }}
            >
              <span style={styles.buttonIcon}>{isMuted ? "🔊" : "🔇"}</span>
              <span>{isMuted ? "Unmute" : "Mute"}</span>
            </button>

            <button
              onClick={() => endCall(true)}
              style={{
                ...styles.controlButton,
                ...styles.endCallButton,
              }}
            >
              <span style={styles.buttonIcon}>☎</span>
              <span>End Call</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (incomingCall) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.incomingBox}>
            <div style={styles.incomingAvatar}>
              {(incomingCall.fromName || incomingCall.from)
                .charAt(0)
                .toUpperCase()}
            </div>

            <div style={styles.incomingCallLabel}>INCOMING CALL</div>

            <h2 style={styles.incomingTitle}>
              {incomingCall.fromName || incomingCall.from}
            </h2>

            <p style={styles.incomingName}>wants to call you</p>

            <p style={styles.incomingId}>Buraq ID: {incomingCall.from}</p>

            <div style={styles.incomingStatus}>
              <span style={styles.statusDot}></span>
              Calling you...
            </div>

            <div style={styles.incomingButtons}>
              <button onClick={acceptCall} style={styles.acceptButton}>
                ✓ Accept
              </button>

              <button onClick={rejectCall} style={styles.rejectButton}>
                ✕ Reject
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (activeChat) {
    const messages = chatMessages[activeChat.id] || [];

    return (
      <div style={styles.page}>
        <div style={styles.chatCard}>
          <div style={styles.chatHeader}>
            <button onClick={closeChat} style={styles.chatBackButton}>
              ←
            </button>

            <div style={styles.chatHeaderAvatar}>
              {(activeChat.name || activeChat.id).charAt(0).toUpperCase()}
            </div>

            <div style={styles.chatHeaderInfo}>
              <div style={styles.chatHeaderName}>{activeChat.name}</div>

              <div style={styles.chatHeaderStatus}>
                <span
                  style={{
                    ...styles.statusDot,
                    background: contactStatuses[activeChat.id]
                      ? "#22c55e"
                      : "#9ca3af",
                  }}
                />{" "}
                {contactStatuses[activeChat.id] ? "Online" : "Offline"}
              </div>
            </div>

            <button
              onClick={() => callUser(activeChat.id, activeChat.name)}
              style={styles.chatCallButton}
              title="Call"
            >
              📞
            </button>

            <button
              onClick={clearChat}
              style={styles.chatClearButton}
              title="Clear chat"
            >
              🗑
            </button>
          </div>

          <div style={styles.messagesArea}>
            {messages.length === 0 ? (
              <div style={styles.chatEmpty}>
                <div style={styles.emptyChatIcon}>💬</div>
                <h3 style={styles.emptyChatTitle}>Start chatting</h3>
                <p style={styles.emptyChatText}>
                  Send a message to {activeChat.name}
                </p>
              </div>
            ) : (
              messages.map((message, index) => {
                const mine = message.from === buraqId;

                return (
                  <div
                    key={index}
                    style={{
                      ...styles.messageRow,
                      justifyContent: mine ? "flex-end" : "flex-start",
                    }}
                  >
                    <div
                      style={{
                        ...styles.messageBubble,
                        background: mine ? "#111827" : "#f1f5f9",
                        color: mine ? "#ffffff" : "#111827",
                      }}
                    >
                      {!mine && (
                        <div style={styles.messageSender}>
                          {message.fromName || activeChat.name}
                        </div>
                      )}

                      <div style={styles.messageText}>{message.message}</div>

                      <div
                        style={{
                          ...styles.messageTime,
                          color: mine ? "#d1d5db" : "#6b7280",
                        }}
                      >
                        {formatTime(message.time)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div style={styles.chatInputArea}>
            <input
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Type a message..."
              style={styles.chatInput}
            />

            <button onClick={sendMessage} style={styles.sendButton}>
              ➤
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {bottomNavigation}

      <div style={styles.card}>
        <audio ref={remoteAudio} autoPlay playsInline />

        <div style={styles.header}>
          <div>
            <div style={styles.miniLogo}>BURAQ</div>
            <p style={styles.subtitle}>Calling & Chat</p>
          </div>

          <button onClick={logout} style={styles.logoutButton}>
            Logout
          </button>
        </div>

        <div style={styles.profileBox}>
          <div style={styles.smallAvatar}>
            {profileName ? profileName.charAt(0).toUpperCase() : "B"}
          </div>

          <div>
            <strong>{profileName}</strong>
            <span style={styles.profileId}>ID: {buraqId}</span>
          </div>
        </div>

        <h3 style={styles.sectionTitle}>Call someone on Buraq</h3>

        <p style={styles.sectionSubtitle}>Enter your friend's Buraq ID</p>

        <div style={{ padding: "0 26px" }}>
          <input
            value={friendId}
            onChange={(e) => setFriendId(e.target.value)}
            placeholder="Friend Buraq ID"
            style={styles.input}
          />
        </div>

        <button
          onClick={() => callUser(friendId, friendId)}
          style={styles.callButton}
        >
          📞 Call
        </button>

        <div style={styles.statusBox}>
          <span style={styles.statusDot}></span>
          <strong>{status}</strong>
        </div>

        <div style={styles.contactsHeader}>
          <div>
            <h3 style={styles.contactsTitle}>My Contacts</h3>
            <p style={styles.contactsSubtitle}>
              Chat or call your Buraq contacts
            </p>
          </div>
        </div>

        <div style={styles.addContactBox}>
          <input
            value={friendId}
            onChange={(e) => setFriendId(e.target.value)}
            placeholder="Buraq ID"
            style={styles.contactInput}
          />

          <input
            value={friendName}
            onChange={(e) => setFriendName(e.target.value)}
            placeholder="Friend name"
            style={styles.contactInput}
          />

          <button onClick={addContact} style={styles.addContactButton}>
            + Add Contact
          </button>
        </div>

        {contacts.length === 0 ? (
          <div style={styles.noContacts}>
            <div style={styles.noContactsIcon}>👥</div>
            <div style={styles.noContactsTitle}>No contacts yet</div>
            <div style={styles.noContactsText}>Add a Buraq ID above</div>
          </div>
        ) : (
          <div style={styles.contactsList}>
            {contacts.map((contact) => (
              <div key={contact.id} style={styles.contactCard}>
                <div style={styles.contactAvatar}>
                  {(contact.name || contact.id).charAt(0).toUpperCase()}
                </div>

                <div style={styles.contactInfo}>
                  <div style={styles.contactName}>{contact.name}</div>

                  <div style={styles.contactId}>{contact.id}</div>

                  <div style={styles.onlineStatus}>
                    <span
                      style={{
                        ...styles.statusDot,
                        background: contactStatuses[contact.id]
                          ? "#22c55e"
                          : "#9ca3af",
                      }}
                    />
                    {contactStatuses[contact.id] ? "Online" : "Offline"}
                  </div>
                </div>

                <div style={styles.contactActions}>
                  <button
                    onClick={() => openChat(contact)}
                    style={styles.contactChatButton}
                    title="Chat"
                  >
                    💬
                    {(unreadCounts[contact.id] || 0) > 0 && (
                      <span style={styles.unreadBadge}>
                        {unreadCounts[contact.id]}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => callUser(contact.id, contact.name)}
                    style={styles.contactCallButton}
                    title="Call"
                  >
                    📞
                  </button>

                  <button
                    onClick={() => removeContact(contact.id)}
                    style={styles.contactDeleteButton}
                    title="Remove"
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={styles.footer}>Buraq • Calling & Chat</div>
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", width: "100%", boxSizing: "border-box", padding: "28px 18px", background: "linear-gradient(135deg,#eef4ff 0%,#f8fafc 48%,#eef2ff 100%)", fontFamily: "Inter,Segoe UI,Arial,sans-serif", color: "#172033" },
  card: { width: "100%", maxWidth: "980px", margin: "0 auto", background: "rgba(255,255,255,.94)", border: "1px solid rgba(226,232,240,.9)", borderRadius: "28px", boxShadow: "0 24px 70px rgba(15,23,42,.12)", overflow: "hidden", boxSizing: "border-box" },
  loginCard: { width: "100%", maxWidth: "430px", margin: "8vh auto 0", padding: "34px", background: "rgba(255,255,255,.96)", border: "1px solid #e2e8f0", borderRadius: "28px", boxShadow: "0 24px 70px rgba(15,23,42,.14)", boxSizing: "border-box" },
  chatCard: { width: "100%", maxWidth: "980px", height: "min(760px,calc(100vh - 56px))", minHeight: "560px", margin: "0 auto", background: "#fff", border: "1px solid #e2e8f0", borderRadius: "28px", boxShadow: "0 24px 70px rgba(15,23,42,.12)", overflow: "hidden", display: "flex", flexDirection: "column" },
  callPage: { minHeight: "100vh", width: "100%", boxSizing: "border-box", padding: "24px 18px", background: "radial-gradient(circle at top,#243b75 0%,#0b1220 55%,#050914 100%)", fontFamily: "Inter,Segoe UI,Arial,sans-serif", color: "#fff" },
  callScreen: { width: "100%", maxWidth: "560px", minHeight: "calc(100vh - 48px)", margin: "0 auto", borderRadius: "32px", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", padding: "30px", boxSizing: "border-box", backdropFilter: "blur(18px)" },
  logoCircle: { width: "78px", height: "78px", borderRadius: "24px", background: "linear-gradient(135deg,#4f46e5,#06b6d4)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "27px", fontWeight: "900", margin: "0 auto 18px", boxShadow: "0 14px 35px rgba(79,70,229,.28)" },
  logo: { fontSize: "30px", fontWeight: "900", letterSpacing: "2px", textAlign: "center", marginBottom: "6px" },
  miniLogo: { fontSize: "24px", fontWeight: "900", letterSpacing: "2px", color: "#111827" },
  subtitle: { margin: "3px 0 0", color: "#64748b", fontSize: "13px", fontWeight: "600" },
  input: { width: "100%", boxSizing: "border-box", padding: "14px 15px", marginTop: "10px", border: "1px solid #dbe3ef", borderRadius: "14px", outline: "none", fontSize: "15px", background: "#f8fafc", color: "#111827" },
  primaryButton: { width: "100%", padding: "14px", marginTop: "14px", border: "none", borderRadius: "14px", background: "linear-gradient(135deg,#4f46e5,#2563eb)", color: "#fff", fontSize: "15px", fontWeight: "800", cursor: "pointer", boxShadow: "0 12px 25px rgba(37,99,235,.22)" },
  linkButton: { border: "none", background: "transparent", color: "#4f46e5", fontWeight: "700", cursor: "pointer", marginTop: "14px", padding: "5px" },
  error: { marginTop: "12px", padding: "11px 13px", borderRadius: "12px", background: "#fff1f2", border: "1px solid #fecdd3", color: "#be123c", fontSize: "13px", fontWeight: "600" },
  serverStatus: { marginTop: "14px", padding: "10px 12px", borderRadius: "12px", background: "#f8fafc", color: "#64748b", fontSize: "12px", textAlign: "center" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "15px", padding: "22px 26px", borderBottom: "1px solid #eef2f7", background: "rgba(255,255,255,.92)" },
  logoutButton: { border: "1px solid #e2e8f0", background: "#fff", color: "#475569", padding: "10px 14px", borderRadius: "12px", fontWeight: "700", cursor: "pointer" },
  profileBox: { margin: "22px 26px", padding: "18px", borderRadius: "20px", background: "linear-gradient(135deg,#111827,#263554)", color: "#fff", display: "flex", alignItems: "center", gap: "14px", boxShadow: "0 16px 30px rgba(15,23,42,.16)" },
  smallAvatar: { width: "52px", height: "52px", borderRadius: "17px", background: "linear-gradient(135deg,#6366f1,#22d3ee)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "21px", fontWeight: "900", flexShrink: 0 },
  profileId: { display: "block", marginTop: "4px", color: "#cbd5e1", fontSize: "12px" },
  sectionTitle: { margin: "22px 26px 5px", color: "#0f172a", fontSize: "21px" },
  sectionSubtitle: { margin: "0 26px", color: "#64748b", fontSize: "13px" },
  callButton: { width: "calc(100% - 52px)", margin: "12px 26px 0", padding: "15px", border: "none", borderRadius: "15px", background: "linear-gradient(135deg,#16a34a,#059669)", color: "#fff", fontSize: "16px", fontWeight: "800", cursor: "pointer", boxShadow: "0 12px 25px rgba(5,150,105,.2)" },
  statusBox: { margin: "12px 26px 0", padding: "11px 14px", background: "#f8fafc", border: "1px solid #e8edf4", borderRadius: "13px", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "#475569", fontSize: "13px" },
  statusDot: { width: "9px", height: "9px", borderRadius: "50%", background: "#22c55e", display: "inline-block", flexShrink: 0 },
  contactsHeader: { margin: "28px 26px 0", display: "flex", justifyContent: "space-between" },
  contactsTitle: { margin: 0, color: "#0f172a", fontSize: "19px" },
  contactsSubtitle: { margin: "5px 0 0", color: "#64748b", fontSize: "13px" },
  addContactBox: { margin: "14px 26px 0", padding: "16px", background: "#f8fafc", borderRadius: "18px", border: "1px solid #e2e8f0" },
  contactInput: { width: "100%", padding: "12px 13px", marginBottom: "9px", boxSizing: "border-box", border: "1px solid #dbe3ef", borderRadius: "12px", outline: "none", fontSize: "16px", background: "#fff", color: "#111827" },
  addContactButton: { width: "100%", padding: "12px", border: "none", borderRadius: "12px", background: "#111827", color: "#fff", fontWeight: "800", cursor: "pointer" },
  contactsList: { margin: "14px 26px 24px", display: "flex", flexDirection: "column", gap: "10px" },
  contactCard: { display: "flex", alignItems: "center", gap: "12px", padding: "14px", border: "1px solid #e5eaf1", borderRadius: "18px", background: "#fff", boxShadow: "0 5px 18px rgba(15,23,42,.04)" },
  contactAvatar: { width: "46px", height: "46px", borderRadius: "15px", background: "linear-gradient(135deg,#111827,#475569)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "900", flexShrink: 0 },
  contactInfo: { flex: 1, minWidth: 0 },
  contactName: { fontWeight: "800", color: "#172033", fontSize: "14px" },
  contactId: { color: "#64748b", fontSize: "12px", marginTop: "2px" },
  onlineStatus: { marginTop: "5px", display: "flex", alignItems: "center", gap: "5px", color: "#64748b", fontSize: "11px", fontWeight: "700" },
  contactActions: { display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" },
  contactChatButton: { border: "none", borderRadius: "10px", padding: "9px 10px", background: "#eef2ff", cursor: "pointer", fontSize: "14px" },
  contactCallButton: { border: "none", borderRadius: "10px", padding: "9px 10px", background: "#ecfdf5", cursor: "pointer", fontSize: "14px" },
  contactDeleteButton: { border: "none", borderRadius: "10px", padding: "9px 10px", background: "#fff1f2", cursor: "pointer", fontSize: "14px" },
  noContacts: { margin: "14px 26px 28px", padding: "32px 20px", textAlign: "center", border: "1px dashed #cbd5e1", borderRadius: "20px", background: "#f8fafc" },
  noContactsIcon: { fontSize: "34px", marginBottom: "8px" },
  noContactsTitle: { fontWeight: "800", color: "#334155" },
  noContactsText: { marginTop: "4px", color: "#94a3b8", fontSize: "13px" },
  footer: { margin: "0 26px 24px", paddingTop: "18px", borderTop: "1px solid #eef2f7", textAlign: "center", color: "#94a3b8", fontSize: "11px" },
  chatHeader: { display: "flex", alignItems: "center", gap: "12px", padding: "17px 20px", borderBottom: "1px solid #e8edf4", background: "#fff" },
  chatBackButton: { border: "none", background: "#f1f5f9", width: "40px", height: "40px", borderRadius: "12px", cursor: "pointer", fontSize: "18px" },
  chatHeaderAvatar: { width: "43px", height: "43px", borderRadius: "14px", background: "linear-gradient(135deg,#4f46e5,#06b6d4)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "900" },
  chatHeaderInfo: { flex: 1, minWidth: 0 },
  chatHeaderName: { fontWeight: "800", color: "#111827" },
  chatHeaderStatus: { fontSize: "12px", color: "#22a06b", marginTop: "3px" },
  chatCallButton: { border: "none", background: "#ecfdf5", width: "40px", height: "40px", borderRadius: "12px", cursor: "pointer" },
  chatClearButton: { border: "none", background: "#fff1f2", width: "40px", height: "40px", borderRadius: "12px", cursor: "pointer" },
  messagesArea: { flex: 1, overflowY: "auto", padding: "22px", background: "linear-gradient(180deg,#f8fafc,#f1f5f9)" },
  messageRow: { display: "flex", marginBottom: "10px" },
  messageBubble: { maxWidth: "75%", padding: "10px 13px", borderRadius: "16px", boxShadow: "0 3px 10px rgba(15,23,42,.05)" },
  messageSender: { fontSize: "11px", fontWeight: "800", marginBottom: "3px", opacity: 0.75 },
  messageText: { fontSize: "14px", lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" },
  messageTime: { fontSize: "10px", marginTop: "5px", textAlign: "right" },
  chatEmpty: { height: "100%", minHeight: "260px", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", textAlign: "center" },
  emptyChatIcon: { fontSize: "48px", marginBottom: "10px" },
  emptyChatTitle: { fontWeight: "800", color: "#334155" },
  emptyChatText: { marginTop: "5px", color: "#94a3b8", fontSize: "13px" },
  chatInputArea: { display: "flex", gap: "9px", padding: "14px", borderTop: "1px solid #e2e8f0", background: "#fff" },
  chatInput: { flex: 1, minWidth: 0, border: "1px solid #dbe3ef", borderRadius: "14px", padding: "12px 14px", outline: "none", fontSize: "16px", background: "#f8fafc", color: "#111827" },
  sendButton: { width: "46px", height: "46px", border: "none", borderRadius: "14px", background: "linear-gradient(135deg,#4f46e5,#2563eb)", color: "#fff", fontSize: "19px", cursor: "pointer" },
  incomingBox: { width: "100%", maxWidth: "460px", margin: "0 auto", padding: "32px", borderRadius: "28px", background: "#111827", color: "#fff", textAlign: "center", boxSizing: "border-box" },
  incomingAvatar: { width: "88px", height: "88px", margin: "0 auto 18px", borderRadius: "28px", background: "linear-gradient(135deg,#4f46e5,#22d3ee)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "32px", fontWeight: "900" },
  incomingTitle: { fontSize: "25px", fontWeight: "900", marginBottom: "6px" },
  incomingName: { fontSize: "18px", fontWeight: "800" },
  incomingId: { marginTop: "5px", color: "#cbd5e1", fontSize: "12px" },
  incomingCallLabel: { marginTop: "14px", color: "#a5b4fc", fontWeight: "700", fontSize: "13px" },
  incomingStatus: { marginTop: "8px", color: "#94a3b8", fontSize: "12px" },
  incomingButtons: { display: "flex", gap: "10px", marginTop: "24px" },
  acceptButton: { flex: 1, padding: "13px", border: "none", borderRadius: "14px", background: "#16a34a", color: "#fff", fontWeight: "800", cursor: "pointer" },
  rejectButton: { flex: 1, padding: "13px", border: "none", borderRadius: "14px", background: "#ef4444", color: "#fff", fontWeight: "800", cursor: "pointer" },
  callTop: { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" },
  liveBadge: { padding: "8px 11px", borderRadius: "999px", background: "rgba(34,197,94,.14)", color: "#86efac", fontSize: "11px", fontWeight: "800" },
  avatar: { width: "118px", height: "118px", borderRadius: "38px", background: "linear-gradient(135deg,#4f46e5,#06b6d4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "44px", fontWeight: "900", marginTop: "70px", boxShadow: "0 25px 60px rgba(6,182,212,.2)" },
  callerName: { marginTop: "20px", fontSize: "28px", fontWeight: "900", textAlign: "center" },
  callerId: { marginTop: "6px", color: "#94a3b8", fontSize: "13px", textAlign: "center" },
  timer: { marginTop: "14px", fontSize: "18px", color: "#cbd5e1", fontWeight: "700", letterSpacing: "1px" },
  wave: { display: "flex", alignItems: "center", gap: "5px", height: "38px", marginTop: "15px" },
  wave1: { width: "4px", height: "15px", borderRadius: "5px", background: "#22d3ee" },
  wave2: { width: "4px", height: "25px", borderRadius: "5px", background: "#22d3ee" },
  wave3: { width: "4px", height: "34px", borderRadius: "5px", background: "#22d3ee" },
  wave4: { width: "4px", height: "22px", borderRadius: "5px", background: "#22d3ee" },
  wave5: { width: "4px", height: "13px", borderRadius: "5px", background: "#22d3ee" },
  bottomControls: { width: "100%", display: "flex", justifyContent: "center", gap: "12px", marginTop: "45px" },
  controlButton: { width: "58px", height: "58px", border: "1px solid rgba(255,255,255,.12)", borderRadius: "18px", background: "rgba(255,255,255,.09)", color: "#fff", cursor: "pointer", fontSize: "20px" },
  mutedButton: { width: "58px", height: "58px", border: "none", borderRadius: "18px", background: "#f59e0b", color: "#fff", cursor: "pointer", fontSize: "20px" },
  endCallButton: { width: "68px", height: "58px", border: "none", borderRadius: "18px", background: "#ef4444", color: "#fff", cursor: "pointer", fontSize: "21px" },
  callLabel: { fontSize: "12px", color: "#94a3b8", textAlign: "center", marginTop: "9px" },
  buttonIcon: { display: "block", lineHeight: 1 },
  connectionStatus: { padding: "8px 12px", borderRadius: "10px", background: "#f1f5f9", color: "#64748b", fontSize: "12px", fontWeight: "700" },
  unreadBadge: { display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "18px", height: "18px", marginLeft: "4px", padding: "0 5px", borderRadius: "999px", background: "#ef4444", color: "#fff", fontSize: "10px", fontWeight: "800" },
};

export default App;
