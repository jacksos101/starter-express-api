const express = require('express')
const app = express()
app.all('/', (req, res) => {
    console.log("Just got a request!")
    res.send('Modified product feed goes here.')
})
app.listen(process.env.PORT || 3000)
