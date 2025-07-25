"use client";

import BackButton from "@/components/BackButton";
import { PlusIcon, YoutubeIcon } from "@/components/Icons";
import { PlayIcon, PauseIcon, ArrowPathIcon } from '@heroicons/react/24/solid';
import Link from "next/link";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";

// --- Self-contained helper components ---

function HighlightedSentence({ text, isActive, wordRange }) {
  if (!isActive || !wordRange) {
    return <span>{text}</span>;
  }

  const { startChar, endChar } = wordRange;
  const before = text.substring(0, startChar);
  const highlighted = text.substring(startChar, endChar);
  const after = text.substring(endChar);

  return (
    <span>
      {before}
      <span className="speaking-word">{highlighted}</span>
      {after}
    </span>
  );
}

function IngredientsTable({ mealData }) {
  const ingredients = useMemo(() => Object.keys(mealData).map(key => {
    if (key.startsWith("strIngredient") && mealData[key]) {
      const num = key.slice(13);
      if (mealData[`strMeasure${num}`]) return { measure: mealData[`strMeasure${num}`], name: mealData[key] };
    }
    return null;
  }).filter(Boolean), [mealData]);
  return (<div className="overflow-x-auto mt-2"><table className="table w-full"><thead><tr className="text-left"><th className="p-2 w-1/3 text-sm font-semibold text-gray-600">Quantity</th><th className="p-2 text-sm font-semibold text-gray-600">Ingredient</th></tr></thead><tbody>{ingredients.map((ing, i) => <tr key={i} className="border-t border-gray-200 hover:bg-gray-50"><td className="p-2 font-medium text-primary">{ing.measure}</td><td className="p-2 text-gray-800">{ing.name}</td></tr>)}</tbody></table></div>);
}

// --- The Main Page Component ---
function ShowMeal({ URL, mealData: mealDataProp }) {
  const [mealData, setMealData] = useState(mealDataProp || null);
  const [playerState, setPlayerState] = useState('idle');
  const [activeWordRange, setActiveWordRange] = useState({ sentenceIndex: -1, startChar: -1, endChar: -1 });
  const utterances = useRef([]);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [ratings, setRatings] = useState([]);
  const [myRating, setMyRating] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [isFavorite, setIsFavorite] = useState(false);
  const [message, setMessage] = useState("");

  const instructionSentences = useMemo(() => {
    if (!mealData?.strInstructions) return [];
    // Clean each instruction: remove leading numbers, dots, parentheses, and trim whitespace
    return mealData.strInstructions
      .split(/\r?\n/)
      .map(s => s.replace(/^\s*\d+([.)])?\s*/, "").trim())
      .filter(Boolean);
  }, [mealData]);

  useEffect(() => {
    const synth = window.speechSynthesis;
    synth.cancel();

    utterances.current = instructionSentences.map((text, sentenceIndex) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 1;
      
      utterance.onboundary = (event) => {
        if (event.name === 'word') {
          setActiveWordRange({
            sentenceIndex,
            startChar: event.charIndex,
            endChar: event.charIndex + event.charLength,
          });
        }
      };

      utterance.onend = () => {
        if (sentenceIndex === instructionSentences.length - 1) {
          setPlayerState('idle');
          setActiveWordRange({ sentenceIndex: -1, startChar: -1, endChar: -1 });
        }
      };
      return utterance;
    });

    return () => synth.cancel();
  }, [instructionSentences]);

  const handlePlay = useCallback(() => {
    const synth = window.speechSynthesis;
    if (playerState === 'paused') {
      synth.resume();
    } else {
      utterances.current.forEach(utterance => synth.speak(utterance));
    }
    setPlayerState('playing');
  }, [playerState]);

  const handlePause = useCallback(() => {
    window.speechSynthesis.pause();
    setPlayerState('paused');
  }, []);
  
  const handleRestart = useCallback(() => {
    window.speechSynthesis.cancel();
    setPlayerState('idle');
    setTimeout(() => {
        handlePlay();
    }, 100);
  }, [handlePlay]);

  useEffect(() => {
    if (mealDataProp) return; // Don't fetch if mealData is provided
    if (!URL) return;
    fetch(URL)
      .then(res => res.json())
      .then(data => setMealData(data.meals[0]))
      .catch(error => console.error("Error fetching data:", error));
  }, [URL, mealDataProp]);

  useEffect(() => {
    if (!mealData) return;
    const recipeId = mealData.id || mealData.idMeal;
    if (!recipeId) return;
    fetch(`/api/comment?recipeId=${recipeId}`)
      .then(res => res.json()).then(setComments);
    fetch(`/api/rating?recipeId=${recipeId}`)
      .then(res => res.json()).then(data => {
        setRatings(data);
        setMyRating(data.find(r => r.userId === 1)?.value || null); // Assuming a default user ID for now
      });
    fetch(`/api/favorite?recipeId=${recipeId}`)
      .then(res => res.json()).then(data => {
        setFavorites(data);
        setIsFavorite(data.some(f => f.recipeId === recipeId));
      });
  }, [mealData]);

  const handleComment = async e => {
    e.preventDefault();
    setMessage("");
    const recipeId = mealData?.id || mealData?.idMeal;
    if (!recipeId) {
      setMessage("Error: No recipe selected.");
      return;
    }
    if (!commentText.trim()) return;
    let body = { recipeId, content: commentText };
    if (!mealData?.id && mealData?.idMeal) {
      // If this is a random/external recipe, send recipeData
      body.recipeData = mealData;
    }
    const res = await fetch("/api/comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      setMessage("Comment added!");
      setCommentText("");
      fetch(`/api/comment?recipeId=${recipeId}`).then(res => res.json()).then(setComments);
    } else {
      setMessage(data.error || "Failed to add comment.");
    }
  };

  const handleRating = async value => {
    setMessage("");
    const recipeId = mealData?.id || mealData?.idMeal;
    if (!recipeId) {
      setMessage("Error: No recipe selected.");
      return;
    }
    let body = { recipeId, value };
    if (!mealData?.id && mealData?.idMeal) {
      // If this is a random/external recipe, send recipeData
      body.recipeData = mealData;
    }
    const res = await fetch("/api/rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      setMessage("Rating submitted!");
      setMyRating(value);
      fetch(`/api/rating?recipeId=${recipeId}`).then(res => res.json()).then(setRatings);
    } else {
      setMessage(data.error || "Failed to submit rating.");
    }
  };

  const handleFavorite = async () => {
    setMessage("");
    const recipeId = mealData?.id || mealData?.idMeal;
    if (!recipeId) {
      setMessage("Error: No recipe selected.");
      return;
    }
    if (isFavorite) {
      const fav = favorites.find(f => f.recipeId === recipeId);
      await fetch("/api/favorite", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: fav.id }),
      });
      setMessage("Removed from favorites.");
    } else {
      let body = { recipeId };
      if (!mealData?.id && mealData?.idMeal) {
        // If this is a random/external recipe, send recipeData
        body.recipeData = mealData;
      }
      const res = await fetch("/api/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage("Added to favorites!");
      } else {
        setMessage(data.error || "Failed to add favorite.");
      }
    }
    fetch(`/api/favorite?recipeId=${recipeId}`)
      .then(res => res.json()).then(data => {
        setFavorites(data);
        setIsFavorite(data.some(f => f.recipeId === recipeId));
      });
  };

  if (!mealData) {
    return <div className="min-h-screen flex justify-center items-center p-4"><div className="max-w-4xl w-full p-12 bg-white rounded-xl shadow-md"><div className="animate-pulse"><div className="h-10 bg-gray-300 rounded-md w-3/4 mx-auto mb-4"></div><div className="h-6 bg-gray-200 rounded-md w-1/4 mx-auto mb-10"></div><div className="flex flex-col md:flex-row gap-12"><div className="md:w-1/2"><div className="h-80 bg-gray-300 rounded-lg"></div></div><div className="md:w-1/2 space-y-4"><div className="h-8 bg-gray-300 rounded-md w-1/2"></div><div className="h-5 bg-gray-200 rounded-md"></div><div className="h-5 bg-gray-200 rounded-md"></div><div className="h-5 bg-gray-200 rounded-md"></div><div className="h-5 bg-gray-200 rounded-md"></div></div></div></div></div></div>;
  }

  return (
    <div className="min-h-screen py-10 px-4 bg-blue-100 flex justify-center items-start">
      <BackButton />
      <div className="relative max-w-4xl w-full bg-white shadow-xl rounded-xl">
        <div className="p-6 md:p-12">
          <header className="text-center mb-8"><h1 className="text-3xl md:text-5xl font-bold text-gray-900">{mealData.strMeal}</h1><p className="text-lg text-gray-500 mt-2">{mealData.strArea} Cuisine</p></header>
          <div className="flex flex-col md:flex-row gap-8 md:gap-12 mb-12"><div className="md:w-1/2"><img src={mealData.strMealThumb} alt={mealData.strMeal} className="w-full h-auto rounded-lg shadow-md mb-4" /><div className="flex items-center gap-4"><span className="badge badge-lg badge-accent">{mealData.strCategory}</span>{mealData.strYoutube && (<Link href={mealData.strYoutube} target="_blank" rel="noopener noreferrer" className="btn btn-error btn-sm gap-2"><YoutubeIcon /> Watch</Link>)}</div></div><div className="md:w-1/2"><h2 className="text-2xl font-bold mb-2 flex items-center text-gray-800"><PlusIcon /><span className="ml-2">Ingredients</span></h2><IngredientsTable mealData={mealData} /></div></div>
          
          <section id="instructions-section">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-gray-800">Preparation Steps</h2>
                <div className="flex items-center gap-2 p-1 border border-gray-200 rounded-full bg-gray-50">
                    <button onClick={playerState === 'playing' ? handlePause : handlePlay} className="btn btn-ghost btn-circle">
                        {playerState === 'playing' ? <PauseIcon className="h-6 w-6 text-blue-600" /> : <PlayIcon className="h-6 w-6 text-green-600" />}
                    </button>
                    <button onClick={handleRestart} className="btn btn-ghost btn-circle" disabled={playerState === 'idle'}>
                        <ArrowPathIcon className="h-5 w-5 text-gray-600" />
                    </button>
                </div>
            </div>
            
            <ol className="list-decimal list-inside space-y-4 text-gray-700 leading-relaxed">
              {instructionSentences.map((sentence, index) => (
                <li key={index}>
                  <HighlightedSentence
                    text={sentence}
                    isActive={index === activeWordRange.sentenceIndex}
                    wordRange={activeWordRange}
                  />
                </li>
              ))}
            </ol>
          </section>

          {/* --- Comments, Ratings, Favorites --- */}
          <section className="mt-10">
            {message && <div className="mb-4 text-center text-md font-semibold text-red-600">{message}</div>}
            <div className="flex items-center gap-4 mb-4">
              <span className="font-bold text-lg">Average Rating:</span>
              <span className="text-yellow-500 font-bold">{ratings.length ? (ratings.reduce((a, b) => a + b.value, 0) / ratings.length).toFixed(1) : "N/A"}</span>
              {[1,2,3,4,5].map(val => (
                    <button key={val} className={`ml-1 ${myRating === val ? "text-yellow-500" : "text-gray-400"}`} onClick={() => handleRating(val)}>
                      ★
                    </button>
                  ))}
              <button className={`btn btn-sm ml-4 ${isFavorite ? "btn-warning" : "btn-outline"}`} onClick={handleFavorite}>
                {isFavorite ? "Unfavorite" : "Favorite"}
              </button>
            </div>
            <div className="mb-4">
              <span className="font-bold text-lg">Comments:</span>
            </div>
            <ul className="mb-4">
              {comments.map(c => (
                <li key={c.id} className="border-b py-2">
                  <span className="font-semibold">{c.user?.name || "User"}:</span> {c.content}
                </li>
              ))}
            </ul>
            <form onSubmit={handleComment} className="flex gap-2">
              <input className="input input-bordered flex-1" value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Add a comment..." />
              <button className="btn btn-primary" type="submit">Post</button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

export default ShowMeal;
