"""Measured pitch is a continuity cue, never a speaker identity or gender label."""
import wave
import numpy as np

def measure(path):
    with wave.open(str(path),'rb') as audio:
        rate=audio.getframerate()
        if rate!=16000 or audio.getnchannels()!=1 or audio.getsampwidth()!=2:
            raise ValueError('Expected 16 kHz mono PCM audio')
        samples=np.frombuffer(audio.readframes(audio.getnframes()),np.int16).astype(float)/32768
    result=[]
    for start in range(0,len(samples)-640,160):
        frame=samples[start:start+640];frame=frame-frame.mean()
        if np.sqrt(np.mean(frame*frame))<.008:continue
        fft=np.fft.rfft(frame,2048)
        corr=np.fft.irfft(fft*np.conjugate(fft),2048)[:201]
        power=np.concatenate(([0],np.cumsum(frame*frame)));lags=np.arange(1,201)
        difference=np.maximum(0,power[640-lags]+power[640]-power[lags]-2*corr[1:201])
        normalized=difference*lags/np.maximum(np.cumsum(difference),1e-12)
        candidates=np.where((lags>=36)&(normalized<.18))[0]
        if not len(candidates):continue
        index=candidates[0]
        while index+1<len(normalized) and normalized[index+1]<normalized[index]:index+=1
        result.append(dict(time_ms=round((start+320)/rate*1000),f0_hz=round(rate/(index+1),1),confidence=round(1-normalized[index],3)))
    return result
