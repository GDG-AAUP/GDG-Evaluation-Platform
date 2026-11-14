// Converts a valid positive integer string to a number.
// Returns null if the input is invalid.
const parsePositiveId = (value) => {
  if (typeof value !== 'string' || 
    !/^[1-9]\d*$/.test(value)) {
    return null
  }

  const id = Number(value)

  return Number.isSafeInteger(id) && id <= 2147483647 ? id : null
}

module.exports = parsePositiveId
