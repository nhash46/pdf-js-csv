(function() {
  //Declaring variables  
  var fs, reptxt, filedata;

  pdf2csv = require ('./pdf2csv');
  pdf2csv.pdf2csv('examples/tests.pdf', 'output.csv'); 
}).call(this)