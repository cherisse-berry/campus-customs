"""Send one real message to the shopping assistant to check the API key and model work.

Usage (from the backend/ folder, after `python setup_env.py --api-key`):
    python check_chat.py
    python check_chat.py "Do you have navy hoodies under $70?"

This makes one or two real Claude API calls (a fraction of a cent).
"""

import asyncio
import sys

from pydantic_ai.exceptions import ContentFilterError, ModelAPIError, ModelHTTPError

from app.chat import agent as chat_agent


async def main(question: str) -> int:
    print(f"Model: {chat_agent.model_name()}")
    print(f"You: {question}\n")
    try:
        reply, cards = await chat_agent.run_chat(question, history=[], customer_first_name=None)
    except chat_agent.AssistantNotConfigured:
        print("ANTHROPIC_API_KEY is not set. Run `python setup_env.py --api-key` first.")
        return 1
    except ModelHTTPError as e:
        hint = {401: "The API key was rejected. Check it and run setup_env.py --api-key again.",
                403: "This key can't use that model. Check your Anthropic account or CHAT_MODEL.",
                404: "Model not found. Check CHAT_MODEL in .env.",
                429: "Rate limited or out of credit. Check your Anthropic account."}
        print(f"API error {e.status_code}. {hint.get(e.status_code, '')}")
        return 1
    except ModelAPIError as e:
        print(f"Couldn't reach the Anthropic API: {type(e).__name__}. Check your internet connection.")
        return 1
    except ContentFilterError:
        print("The model declined this message. Try a normal shopping question.")
        return 1
    print(f"Assistant: {reply}\n")
    print("Product cards:", ", ".join(c["name"] for c in cards) or "none")
    print("\nThe assistant is working.")
    return 0


if __name__ == "__main__":
    question = " ".join(sys.argv[1:]) or "What hoodies do you have under $70?"
    sys.exit(asyncio.run(main(question)))
