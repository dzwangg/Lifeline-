"""Standalone simulation worker:  python -m chsim.worker"""
from .jobs import run_worker

if __name__ == "__main__":
    print("chsim worker polling the job queue (Ctrl+C to stop)")
    run_worker()
