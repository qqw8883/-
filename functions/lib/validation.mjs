export function validateWordPair(value) {
  for (const key of ['civilianWord','undercoverWord','subtleHint','openingJoke']) {
    if (typeof value?.[key] !== 'string' || !value[key].trim()) throw new Error('AI 返回的词组不完整，请重试。');
  }
  const result = Object.fromEntries(['civilianWord','undercoverWord','subtleHint','openingJoke'].map(k=>[k,value[k].trim()]));
  if(result.subtleHint.length>300||result.openingJoke.length>300)throw new Error('AI 返回的内容过长，请重试。');
  if (result.civilianWord === result.undercoverWord || result.civilianWord.length > 12 || result.undercoverWord.length > 12) {
    throw new Error('AI 返回的词组不适合本局，请重试。');
  }
  for (const field of ['subtleHint','openingJoke']) {
    if ([result.civilianWord,result.undercoverWord].some(word=>result[field].includes(word))) {
      throw new Error('AI 主持词包含底牌内容，已阻止剧透，请重试。');
    }
  }
  return result;
}
